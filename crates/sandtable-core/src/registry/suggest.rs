//! 相近路径建议:编辑距离 ≤ 3 的候选,按距离升序取至多 3 条。
use super::spec::all;
pub fn suggestions(path: &str) -> Vec<&'static str> {
    let mut cands: Vec<(usize, &'static str)> = all()
        .map(|s| (edit_distance(path, s.path), s.path))
        .filter(|(d, _)| *d <= 3)
        .collect();
    cands.sort_by_key(|(d, _)| *d);
    cands.into_iter().map(|(_, p)| p).take(3).collect()
}

pub(super) fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            cur[j] = (prev[j] + 1)
                .min(cur[j - 1] + 1)
                .min(prev[j - 1] + usize::from(a[i - 1] != b[j - 1]));
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}
