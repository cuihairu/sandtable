---
title: 10 · CLI
---

# CLI

第一阶段 CLI 是第一优先级 UI。

## 子命令

| 命令 | 作用 | 阶段 |
| --- | --- | --- |
| `sandtable simulate` | 运行一次仿真 | **MVP** |
| `sandtable compare` | 比较两个 / 多个运行结果 | **MVP** |
| `sandtable validate` | 校验配置(注册表、schema、公式) | **MVP** |
| `sandtable init` | 生成示例配置骨架 | MVP 顺带 |
| `sandtable sweep` | 参数扫描实验 | Phase 3 |
| `sandtable report` | 生成 HTML 报告 | Phase 5 |

## 用法

```bash
sandtable simulate scenario.yaml
sandtable sweep experiment.yaml
sandtable compare result-a result-b
sandtable report experiment/
```

## 输出约定

- **stdout**:人读摘要(运行耗时、关键指标、约束 PASS / FAIL),面向终端;
- **文件**:完整结果按[输出目录约定](./09-data-output)落盘,stdout 不承载完整数据;
- **退出码**:`0` 成功;`1` 仿真或实验失败;`2` 配置 / 参数错误(用于 CI 区分);

## 确定性要求

`compare` 的输出对相同输入必须稳定:排序确定性(候选按实验标识排序,不按目录遍历序)、浮点格式固定(避免科学计数法抖动)。同 seed 重跑 `simulate`,除 `meta.json` 中环境字段外,输出内容一致([数据输出](./09-data-output))。

## 错误信息风格

配置错误必须指出**具体路径与原因**(如 `warrior.atk: 未知参数,你是否想写 warrior.attack?注册表中相近路径: warrior.attack`),错误信息面向配置作者,不面向内核开发者。
