//! 公式引擎(文档 07 章):受控表达式的**加载期编译**求值器。
//!
//! 能力面有界,不是通用脚本语言:算术、比较、布尔、三元条件、内置函数
//! (min / max / clamp / floor / ceil / abs / round);表查找等按
//! [MVP 内置系统的实际需要](./07-config-formula)逐步加入。
//!
//! 执行模型:字符串 → 递归下降解析为 AST → 变量名按白名单解析为环境下标
//! → [`Formula`];运行期 [`Formula::eval`] 按索引取值,零字符串查找。
//!
//! 语法约定:
//! - `^` 为 powf 且**右结合**(`2^3^2 = 512`),优先级高于一元负号与非
//!   (`-2^2 = -4`,`!x^2 = !(x^2)`);指数侧允许一元负号(`2^-1 = 0.5`);
//! - 比较与布尔的结果为 1.0 / 0.0;条件以"非 0 为真"判定;
//! - 除法 / 取模对 0 除数返回 0.0(公式槽可在 validate 层另行约束),
//!   `&&` / `||` / 三元均短路求值。
//!
//! 有界性:输入 ≤ [`MAX_INPUT`] 字符、括号与函数嵌套 ≤ [`MAX_DEPTH`] 层、
//! 函数名与变量名一律白名单,越界即编译期报错(带位置)。

/// 公式输入长度上限(字符数)。
pub const MAX_INPUT: usize = 512;
/// 括号 / 函数实参嵌套深度上限。
pub const MAX_DEPTH: u32 = 32;

/// `formulas.xp_needed` 槽的变量白名单与环境顺序。
pub const XP_NEEDED_VARS: &[&str] = &["level", "xp_base", "xp_pow"];

/// 编译产物:AST 根 + 变量数。求值只做算术,无字符串参与。
#[derive(Debug, Clone)]
pub struct Formula {
    root: Expr,
    n_vars: usize,
}

impl Formula {
    /// 按编译时的变量顺序求值。`env` 长度不足的位置按 NaN 处理
    /// (调用方契约:env 顺序必须与 compile 时的 `vars` 一致)。
    pub fn eval(&self, env: &[f64]) -> f64 {
        debug_assert!(
            env.len() >= self.n_vars,
            "公式环境变量数 ({}) 少于编译时的白名单 ({})",
            env.len(),
            self.n_vars
        );
        eval_expr(&self.root, env)
    }
}

/// 加载期编译:字符串 → [`Formula`]。失败返回带位置的错误说明。
pub fn compile(src: &str, vars: &[&str]) -> Result<Formula, String> {
    if src.trim().is_empty() {
        return Err("公式为空".into());
    }
    if src.chars().count() > MAX_INPUT {
        return Err(format!("公式超过 {MAX_INPUT} 字符上限"));
    }
    let chars: Vec<char> = src.chars().collect();
    let mut p = Parser {
        src: &chars,
        pos: 0,
        vars,
        depth: 0,
    };
    let root = p.parse_expr()?;
    p.skip_ws();
    if p.pos < p.src.len() {
        let c = p.src[p.pos];
        if c == '=' {
            return Err(p.err(p.pos, "意外的字符 '='(相等比较请写 '==')"));
        }
        return Err(p.err(p.pos, &format!("意外的字符 {c:?}")));
    }
    Ok(Formula {
        root,
        n_vars: vars.len(),
    })
}

#[derive(Debug, Clone)]
enum Expr {
    Const(f64),
    Var(u32),
    Neg(Box<Expr>),
    Not(Box<Expr>),
    Add(Box<Expr>, Box<Expr>),
    Sub(Box<Expr>, Box<Expr>),
    Mul(Box<Expr>, Box<Expr>),
    Div(Box<Expr>, Box<Expr>),
    Rem(Box<Expr>, Box<Expr>),
    Pow(Box<Expr>, Box<Expr>),
    Lt(Box<Expr>, Box<Expr>),
    Le(Box<Expr>, Box<Expr>),
    Gt(Box<Expr>, Box<Expr>),
    Ge(Box<Expr>, Box<Expr>),
    Eq(Box<Expr>, Box<Expr>),
    Ne(Box<Expr>, Box<Expr>),
    And(Box<Expr>, Box<Expr>),
    Or(Box<Expr>, Box<Expr>),
    Ternary(Box<Expr>, Box<Expr>, Box<Expr>),
    Call(Builtin, Vec<Expr>),
}

/// 关系运算的中间标记(parse_rel 内部装配用)。
enum Op {
    Lt,
    Le,
    Gt,
    Ge,
}

/// 内置函数白名单(文档 07 章能力面;表查找等按需加入)。
#[derive(Debug, Clone, Copy)]
enum Builtin {
    Min,
    Max,
    Clamp,
    Floor,
    Ceil,
    Abs,
    Round,
}

impl Builtin {
    fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "min" => Builtin::Min,
            "max" => Builtin::Max,
            "clamp" => Builtin::Clamp,
            "floor" => Builtin::Floor,
            "ceil" => Builtin::Ceil,
            "abs" => Builtin::Abs,
            "round" => Builtin::Round,
            _ => return None,
        })
    }

    fn arity(self) -> usize {
        match self {
            Builtin::Min | Builtin::Max => 2,
            Builtin::Clamp => 3,
            Builtin::Floor | Builtin::Ceil | Builtin::Abs | Builtin::Round => 1,
        }
    }
}

/// 文法(优先级自低到高):
/// `ternary → or ('?' expr ':' ternary)?` → `or → and ('||' and)*` →
/// `and → eq ('&&' eq)*` → `eq → rel (('=='|'!=') rel)*` →
/// `rel → add (('<'|'<='|'>'|'>=') add)*` → `add → mul (('+'|'-') mul)*` →
/// `mul → unary (('*'|'/'|'%') unary)*` → `unary → ('-'|'!') unary | pow` →
/// `pow → primary ('^' unary)?`(右结合) → `primary → 数 | 变量 | 函数 | (expr)`。
struct Parser<'a> {
    src: &'a [char],
    pos: usize,
    vars: &'a [&'a str],
    depth: u32,
}

impl<'a> Parser<'a> {
    fn err(&self, pos: usize, msg: &str) -> String {
        format!("位置 {}: {msg}", pos + 1)
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) {
        self.pos += 1;
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ' | '\t')) {
            self.bump();
        }
    }

    fn eat(&mut self, c: char) -> bool {
        if self.peek() == Some(c) {
            self.bump();
            true
        } else {
            false
        }
    }

    fn eat2(&mut self, a: char, b: char) -> bool {
        if self.peek() == Some(a) && self.src.get(self.pos + 1) == Some(&b) {
            self.pos += 2;
            true
        } else {
            false
        }
    }

    fn parse_expr(&mut self) -> Result<Expr, String> {
        self.parse_ternary()
    }

    fn parse_ternary(&mut self) -> Result<Expr, String> {
        let cond = self.parse_or()?;
        self.skip_ws();
        if !self.eat('?') {
            return Ok(cond);
        }
        let then_e = self.parse_ternary()?;
        self.skip_ws();
        if !self.eat(':') {
            return Err(self.err(self.pos, "三元表达式缺少 ':'"));
        }
        let else_e = self.parse_ternary()?;
        Ok(Expr::Ternary(
            Box::new(cond),
            Box::new(then_e),
            Box::new(else_e),
        ))
    }

    fn parse_or(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_and()?;
        loop {
            self.skip_ws();
            if self.eat2('|', '|') {
                let right = self.parse_and()?;
                left = Expr::Or(Box::new(left), Box::new(right));
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_and(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_eq()?;
        loop {
            self.skip_ws();
            if self.eat2('&', '&') {
                let right = self.parse_eq()?;
                left = Expr::And(Box::new(left), Box::new(right));
            } else {
                return Ok(left);
            }
        }
    }

    fn parse_eq(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_rel()?;
        loop {
            self.skip_ws();
            let is_ne = if self.eat2('=', '=') {
                false
            } else if self.eat2('!', '=') {
                true
            } else {
                return Ok(left);
            };
            let right = self.parse_rel()?;
            left = if is_ne {
                Expr::Ne(Box::new(left), Box::new(right))
            } else {
                Expr::Eq(Box::new(left), Box::new(right))
            };
        }
    }

    fn parse_rel(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_add()?;
        loop {
            self.skip_ws();
            let op = if self.eat2('<', '=') {
                Op::Le
            } else if self.eat2('>', '=') {
                Op::Ge
            } else if self.eat('<') {
                Op::Lt
            } else if self.eat('>') {
                Op::Gt
            } else {
                return Ok(left);
            };
            let right = self.parse_add()?;
            left = match op {
                Op::Lt => Expr::Lt(Box::new(left), Box::new(right)),
                Op::Le => Expr::Le(Box::new(left), Box::new(right)),
                Op::Gt => Expr::Gt(Box::new(left), Box::new(right)),
                Op::Ge => Expr::Ge(Box::new(left), Box::new(right)),
            };
        }
    }

    fn parse_add(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_mul()?;
        loop {
            self.skip_ws();
            let op = if self.eat('+') {
                '+'
            } else if self.eat('-') {
                '-'
            } else {
                return Ok(left);
            };
            let right = self.parse_mul()?;
            left = match op {
                '+' => Expr::Add(Box::new(left), Box::new(right)),
                _ => Expr::Sub(Box::new(left), Box::new(right)),
            };
        }
    }

    fn parse_mul(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_unary()?;
        loop {
            self.skip_ws();
            let op = if self.eat('*') {
                '*'
            } else if self.eat('/') {
                '/'
            } else if self.eat('%') {
                '%'
            } else {
                return Ok(left);
            };
            let right = self.parse_unary()?;
            left = match op {
                '*' => Expr::Mul(Box::new(left), Box::new(right)),
                '/' => Expr::Div(Box::new(left), Box::new(right)),
                _ => Expr::Rem(Box::new(left), Box::new(right)),
            };
        }
    }

    fn parse_unary(&mut self) -> Result<Expr, String> {
        self.skip_ws();
        if self.eat('-') {
            let e = self.parse_unary()?;
            return Ok(Expr::Neg(Box::new(e)));
        }
        if self.eat('!') {
            let e = self.parse_unary()?;
            return Ok(Expr::Not(Box::new(e)));
        }
        self.parse_pow()
    }

    fn parse_pow(&mut self) -> Result<Expr, String> {
        let base = self.parse_primary()?;
        self.skip_ws();
        if self.eat('^') {
            // 右结合:指数侧允许一元负号,并继续吃 ^
            let exp = self.parse_unary()?;
            return Ok(Expr::Pow(Box::new(base), Box::new(exp)));
        }
        Ok(base)
    }

    fn parse_primary(&mut self) -> Result<Expr, String> {
        self.skip_ws();
        let start = self.pos;
        match self.peek() {
            None => Err(self.err(self.pos, "表达式意外结束")),
            Some(c) if c.is_ascii_digit() || c == '.' => self.parse_number(),
            Some(c) if c.is_ascii_alphabetic() || c == '_' => self.parse_ident(),
            Some('(') => {
                self.bump();
                self.depth += 1;
                if self.depth > MAX_DEPTH {
                    return Err(self.err(start, &format!("嵌套深度超过 {MAX_DEPTH} 层")));
                }
                let e = self.parse_expr()?;
                self.skip_ws();
                if !self.eat(')') {
                    return Err(self.err(self.pos, "缺少右括号 ')'"));
                }
                self.depth -= 1;
                Ok(e)
            }
            Some(c) => Err(self.err(self.pos, &format!("意外的字符 {c:?}"))),
        }
    }

    fn parse_number(&mut self) -> Result<Expr, String> {
        let start = self.pos;
        let mut seen_dot = false;
        while let Some(c) = self.peek() {
            match c {
                '0'..='9' => self.bump(),
                '.' if !seen_dot => {
                    seen_dot = true;
                    self.bump();
                }
                'e' | 'E' => break,
                _ => break,
            }
        }
        if matches!(self.peek(), Some('e' | 'E')) {
            self.bump();
            if matches!(self.peek(), Some('+' | '-')) {
                self.bump();
            }
            let digits_start = self.pos;
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.bump();
            }
            if self.pos == digits_start {
                return Err(self.err(digits_start, "科学计数法的指数缺少数字"));
            }
        }
        let text: String = self.src[start..self.pos].iter().collect();
        let v: f64 = text
            .parse()
            .map_err(|_| self.err(start, &format!("{text:?} 不是合法数字")))?;
        if !v.is_finite() {
            return Err(self.err(start, &format!("{text:?} 超出有限数范围")));
        }
        Ok(Expr::Const(v))
    }

    fn parse_ident(&mut self) -> Result<Expr, String> {
        let start = self.pos;
        while matches!(self.peek(), Some(c) if c.is_ascii_alphanumeric() || c == '_') {
            self.bump();
        }
        let name: String = self.src[start..self.pos].iter().collect();
        self.skip_ws();
        if self.eat('(') {
            return self.parse_call(&name, start);
        }
        self.vars
            .iter()
            .position(|v| *v == name)
            .map(|i| Expr::Var(i as u32))
            .ok_or_else(|| {
                let available = if self.vars.is_empty() {
                    "(该槽位无可用变量)".to_string()
                } else {
                    format!("可用变量: {}", self.vars.join(", "))
                };
                self.err(start, &format!("未知变量 {name:?},{available}"))
            })
    }

    fn parse_call(&mut self, name: &str, start: usize) -> Result<Expr, String> {
        // '(' 已消费
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(self.err(start, &format!("嵌套深度超过 {MAX_DEPTH} 层")));
        }
        let mut args = Vec::new();
        self.skip_ws();
        if !self.eat(')') {
            loop {
                args.push(self.parse_ternary()?);
                self.skip_ws();
                if self.eat(',') {
                    continue;
                }
                if self.eat(')') {
                    break;
                }
                return Err(self.err(self.pos, "函数实参后应为 ',' 或 ')'"));
            }
        }
        self.depth -= 1;
        let Some(builtin) = Builtin::from_name(name) else {
            return Err(self.err(
                start,
                &format!("未知函数 {name:?}(可用: min, max, clamp, floor, ceil, abs, round)"),
            ));
        };
        if args.len() != builtin.arity() {
            return Err(self.err(
                start,
                &format!(
                    "函数 {} 需要 {} 个实参,实际 {} 个",
                    name,
                    builtin.arity(),
                    args.len()
                ),
            ));
        }
        Ok(Expr::Call(builtin, args))
    }
}

fn truthy(v: f64) -> bool {
    v != 0.0
}

fn eval_expr(e: &Expr, env: &[f64]) -> f64 {
    let ev = |x: &Expr| eval_expr(x, env);
    match e {
        Expr::Const(v) => *v,
        Expr::Var(i) => env.get(*i as usize).copied().unwrap_or(f64::NAN),
        Expr::Neg(x) => -ev(x),
        Expr::Not(x) => {
            if truthy(ev(x)) {
                0.0
            } else {
                1.0
            }
        }
        Expr::Add(a, b) => ev(a) + ev(b),
        Expr::Sub(a, b) => ev(a) - ev(b),
        Expr::Mul(a, b) => ev(a) * ev(b),
        Expr::Div(a, b) => {
            let d = ev(b);
            if d == 0.0 {
                0.0
            } else {
                ev(a) / d
            }
        }
        Expr::Rem(a, b) => {
            let d = ev(b);
            if d == 0.0 {
                0.0
            } else {
                ev(a) % d
            }
        }
        Expr::Pow(a, b) => ev(a).powf(ev(b)),
        Expr::Lt(a, b) => bool_as_f64(ev(a) < ev(b)),
        Expr::Le(a, b) => bool_as_f64(ev(a) <= ev(b)),
        Expr::Gt(a, b) => bool_as_f64(ev(a) > ev(b)),
        Expr::Ge(a, b) => bool_as_f64(ev(a) >= ev(b)),
        Expr::Eq(a, b) => bool_as_f64(ev(a) == ev(b)),
        Expr::Ne(a, b) => bool_as_f64(ev(a) != ev(b)),
        Expr::And(a, b) => {
            if truthy(ev(a)) && truthy(ev(b)) {
                1.0
            } else {
                0.0
            }
        }
        Expr::Or(a, b) => {
            if truthy(ev(a)) || truthy(ev(b)) {
                1.0
            } else {
                0.0
            }
        }
        Expr::Ternary(c, t, f) => {
            if truthy(ev(c)) {
                ev(t)
            } else {
                ev(f)
            }
        }
        Expr::Call(builtin, args) => {
            let a = |i: usize| eval_expr(&args[i], env);
            match builtin {
                Builtin::Min => a(0).min(a(1)),
                Builtin::Max => a(0).max(a(1)),
                Builtin::Clamp => a(0).max(a(1)).min(a(2)),
                Builtin::Floor => a(0).floor(),
                Builtin::Ceil => a(0).ceil(),
                Builtin::Abs => a(0).abs(),
                Builtin::Round => a(0).round(),
            }
        }
    }
}

fn bool_as_f64(b: bool) -> f64 {
    if b {
        1.0
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eval_str(src: &str) -> f64 {
        compile(src, &["level", "xp_base", "xp_pow"])
            .unwrap_or_else(|e| panic!("{src:?} 编译失败: {e}"))
            .eval(&[3.0, 60.0, 1.3])
    }

    #[test]
    fn 优先级_加减乘除() {
        assert_eq!(eval_str("2+3*4"), 14.0);
        assert_eq!(eval_str("10-2-3"), 5.0); // 左结合
        assert_eq!(eval_str("(2+3)*4"), 20.0);
        assert_eq!(eval_str("7/2"), 3.5);
        assert_eq!(eval_str("7%2"), 1.0);
        assert_eq!(eval_str("2*3^2"), 18.0); // 幂高于乘
    }

    #[test]
    fn 幂_右结合与一元负号() {
        assert_eq!(eval_str("2^3^2"), 512.0);
        assert_eq!(eval_str("-2^2"), -4.0); // 幂优先于负号
        assert_eq!(eval_str("(-2)^2"), 4.0);
        assert_eq!(eval_str("2^-1"), 0.5);
    }

    #[test]
    fn 比较与布尔() {
        assert_eq!(eval_str("1+1 == 2"), 1.0);
        assert_eq!(eval_str("xp_base != 60"), 0.0);
        assert_eq!(eval_str("level >= 3"), 1.0);
        assert_eq!(eval_str("level < 3 && xp_base > 50"), 0.0);
        assert_eq!(eval_str("level < 3 || xp_base > 50"), 1.0);
        assert_eq!(eval_str("!(level == 3)"), 0.0);
    }

    #[test]
    fn 三元_短路语义() {
        assert_eq!(eval_str("level > 2 ? 10 : 20"), 10.0);
        assert_eq!(eval_str("1 ? 2 ? 3 : 4 : 5"), 3.0); // 嵌套
        assert_eq!(eval_str("1 ? 2 : 3 ? 4 : 5"), 2.0); // else 右结合
                                                        // 三元只取选中分支(除零被丢弃的分支不影响结果可证短路)
        assert_eq!(eval_str("1 ? 7 : 1/0"), 7.0);
        assert_eq!(eval_str("0 ? 1/0 : 7"), 7.0);
    }

    #[test]
    fn 内置函数() {
        assert_eq!(eval_str("min(3, 4)"), 3.0);
        assert_eq!(eval_str("max(3, 4)"), 4.0);
        assert_eq!(eval_str("clamp(5, 1, 3)"), 3.0);
        assert_eq!(eval_str("clamp(0.5, 1, 3)"), 1.0);
        assert_eq!(eval_str("floor(2.7)"), 2.0);
        assert_eq!(eval_str("ceil(2.1)"), 3.0);
        assert_eq!(eval_str("abs(-2.5)"), 2.5);
        assert_eq!(eval_str("round(2.5)"), 3.0); // 远离零取整(Rust std)
        assert_eq!(eval_str("max(1, min(2, 3))"), 2.0);
    }

    #[test]
    fn 变量按白名单索引取值() {
        let f = compile("xp_base * level", XP_NEEDED_VARS).unwrap();
        assert_eq!(f.eval(&[2.0, 60.0, 1.3]), 120.0);
        assert_eq!(f.eval(&[5.0, 10.0, 1.3]), 50.0);
    }

    #[test]
    fn 默认公式与历史闭式实现逐位一致() {
        // 金线:默认公式 "xp_base * level ^ xp_pow" 必须复现
        // (xp_base as f64 * (level as f64).powf(xp_pow)) as i64 的每一比特
        for level in 1..200u32 {
            for xp_pow in [1.0, 1.3, 2.0] {
                let f = compile("xp_base * level ^ xp_pow", XP_NEEDED_VARS).unwrap();
                let got = f.eval(&[level as f64, 60.0, xp_pow]) as i64;
                let want = (60f64 * (level as f64).powf(xp_pow)) as i64;
                assert_eq!(got, want, "level={level} xp_pow={xp_pow}");
            }
        }
    }

    #[test]
    fn 除零与取模零返回零() {
        assert_eq!(eval_str("1/0"), 0.0);
        assert_eq!(eval_str("5%0"), 0.0);
        assert_eq!(eval_str("1/0 + 5"), 5.0);
    }

    #[test]
    fn 未知变量报错_带位置与可用变量() {
        let e = compile("xp_base * atk", XP_NEEDED_VARS).unwrap_err();
        assert!(e.contains("未知变量"), "{e}");
        assert!(e.contains("atk"), "{e}");
        assert!(e.contains("位置"), "{e}");
        assert!(e.contains("level"), "{e}");
    }

    #[test]
    fn 未知函数与实参个数报错() {
        let e = compile("foo(1)", XP_NEEDED_VARS).unwrap_err();
        assert!(e.contains("未知函数"), "{e}");
        let e = compile("min(1)", XP_NEEDED_VARS).unwrap_err();
        assert!(e.contains("实参"), "{e}");
        let e = compile("clamp(1, 2)", XP_NEEDED_VARS).unwrap_err();
        assert!(e.contains("实参"), "{e}");
    }

    #[test]
    fn 括号不闭合与悬空符号报错() {
        assert!(compile("1 +", XP_NEEDED_VARS).is_err());
        assert!(compile("(1 + 2", XP_NEEDED_VARS)
            .unwrap_err()
            .contains("右括号"));
        assert!(compile("1 + 2)", XP_NEEDED_VARS)
            .unwrap_err()
            .contains("意外的字符"));
        assert!(compile("1 ? 2", XP_NEEDED_VARS)
            .unwrap_err()
            .contains("':'"));
        assert!(compile("1 = 2", XP_NEEDED_VARS)
            .unwrap_err()
            .contains("'=='"));
        assert!(compile("", XP_NEEDED_VARS).is_err());
        assert!(compile("   ", XP_NEEDED_VARS).unwrap_err().contains("为空"));
    }

    #[test]
    fn 深度与长度有界() {
        let deep = format!(
            "{}1{}",
            "(".repeat(MAX_DEPTH as usize + 1),
            ")".repeat(MAX_DEPTH as usize + 1)
        );
        assert!(compile(&deep, XP_NEEDED_VARS)
            .unwrap_err()
            .contains("嵌套深度"));
        // 上限之内可通过
        let ok = format!(
            "{}1{}",
            "(".repeat(MAX_DEPTH as usize),
            ")".repeat(MAX_DEPTH as usize)
        );
        assert!(compile(&ok, XP_NEEDED_VARS).is_ok());

        let long = format!("{}1", "1+".repeat(MAX_INPUT)); // 超一个字符
        assert!(compile(&long, XP_NEEDED_VARS).unwrap_err().contains("上限"));
    }

    #[test]
    fn 非法数字报错() {
        assert!(compile("1.2.3", XP_NEEDED_VARS)
            .unwrap_err()
            .contains("意外的字符"));
        assert!(compile("1e", XP_NEEDED_VARS).unwrap_err().contains("指数"));
        assert!(compile("1e999", XP_NEEDED_VARS)
            .unwrap_err()
            .contains("范围"));
        assert!(compile(".", XP_NEEDED_VARS)
            .unwrap_err()
            .contains("不是合法数字"));
    }

    #[test]
    fn 同一公式重复求值确定() {
        let f = compile("xp_base * level ^ xp_pow", XP_NEEDED_VARS).unwrap();
        let env = [7.0, 60.0, 1.3];
        let a = f.eval(&env);
        let b = f.eval(&env);
        assert_eq!(a.to_bits(), b.to_bits());
    }
}
