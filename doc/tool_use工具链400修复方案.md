# tool_use 工具链 400 修复方案

## 背景

正式环境请求日志中出现上游 Kiro 返回的 400：

```text
Invalid tool use format.
REQUEST_BODY_INVALID
```

以及：

```text
Bedrock error message: Expected toolResult blocks at messages.N.content for the following ids: call_xxx
TOOL_USE_RESULT_MISMATCH
```

这类错误发生在 kirors 已经把 Anthropic / Claude Code 请求转换为 Kiro 上游请求之后，由上游对工具调用历史进行协议校验时拒绝。

该问题和真实缓存、模拟缓存、缓存命中率无关。

## 项目链路定位

kirors 位于 sub2/new-api/Claude Code 用户和 Kiro 上游账号池之间：

```text
用户 / sub2 / new-api
  -> Anthropic messages 请求
  -> kirors 鉴权、选号、会话亲和、请求转换
  -> Kiro 上游 API
  -> kirors 转回 Anthropic 响应
  -> 用户
```

因此修复必须满足：

- 不改变用户侧 Anthropic 协议。
- 不影响 sub2/new-api 正常请求体验。
- 不删除正常合法的工具调用链。
- 不伪造工具执行结果。
- 在发给上游之前修复非法工具链，不能等上游返回 400 后再处理。

## 根因

Anthropic 工具协议要求非常严格：

```text
assistant: tool_use id=call_A
user:      tool_result tool_use_id=call_A
```

如果 assistant 一次返回多个工具：

```text
assistant: tool_use A, tool_use B
user:      tool_result A, tool_result B
```

下一条 user 消息必须紧跟对应 tool_result。只要出现以下情况，上游就可能 400：

- assistant 有 tool_use，但下一条 user 没有对应 tool_result。
- tool_result 被上下文裁剪掉，只剩 tool_use。
- tool_result 出现在更后面的 user 消息中，不是紧跟上一条 assistant。
- user 带了孤立 tool_result，但上一条 assistant 没有对应 tool_use。
- 多工具调用时只返回了部分结果。
- 重复 tool_result。
- 中间层 sub2/new-api/客户端裁剪 messages 时切断了 tool_use 和 tool_result 配对。

当前 `src/anthropic/converter.rs` 已有 `validate_tool_pairing()`，但它主要检查“历史里是否存在某个 id 的结果”，没有严格校验“紧邻顺序”。这会导致迟到的 tool_result 被误判为已配对，但上游仍然认为格式非法。

## 修复目标

在 kirors 发给 Kiro 上游之前，保证转换后的 Kiro 请求满足：

```text
每个保留的 tool_use 都必须在紧跟的 user/currentMessage 中有对应 tool_result
每个保留的 tool_result 都必须对应紧邻前一条 assistant 的 tool_use
```

如果某段工具历史已经不合法，kirors 应该在转换阶段把非法片段移除，使请求退化为可继续对话的普通历史，而不是让上游返回 400。

## 修复原则

| 原则 | 说明 |
|---|---|
| 合法链路不动 | 正常 `assistant tool_use -> user tool_result` 原样保留 |
| 发上游前修复 | 在 `convert_request()` 构造 Kiro request 前完成，不等上游 400 |
| 不伪造结果 | 不生成假的 tool_result，避免污染模型语义 |
| 不吞用户文本 | 只过滤非法 tool_use/tool_result 结构，用户普通文本保留 |
| 保守容错 | 上游必定拒绝的半截工具链才移除 |
| 不碰缓存 | 不修改真实缓存和模拟缓存逻辑 |

## 建议实现位置

文件：

```text
src/anthropic/converter.rs
```

调用位置：

```rust
let mut history = build_history(req, messages, &model_id, &mut tool_name_map)?;
let (text_content, images, tool_results) = process_message_content(&last_message.content)?;

// 新增：严格规范化 tool_use/tool_result 顺序
let validated_tool_results = repair_tool_use_result_sequence(&mut history, &tool_results);
```

然后再构建：

```rust
UserInputMessageContext::with_tool_results(validated_tool_results)
ConversationState::with_history(history)
```

实际插入位置应在 `build_history()` 之后、`ConversationState` 构建之前。

## 核心规则

### 1. 历史消息两两扫描

按顺序扫描转换后的 Kiro history：

```text
history[i]   = assistant
history[i+1] = user
```

如果 assistant 有 tool_uses，则下一条必须是 user，且 user 的 tool_results 必须覆盖这些 tool_use id。

### 2. 部分配对时只保留合法部分

示例：

```text
assistant: tool_use A, tool_use B
user:      tool_result A
```

修复后：

```text
assistant: tool_use A
user:      tool_result A
```

B 被移除，因为 B 没有结果。

### 3. user 中多余 tool_result 删除

示例：

```text
assistant: tool_use A
user:      tool_result A, tool_result C
```

修复后：

```text
assistant: tool_use A
user:      tool_result A
```

C 是孤立结果，删除。

### 4. tool_result 迟到时删除

示例：

```text
assistant: tool_use A
user:      普通文本
assistant: 普通回复
user:      tool_result A
```

修复后：

```text
assistant: 普通内容
user:      普通文本
assistant: 普通回复
user:      空工具结果被过滤，只保留普通文本
```

迟到的 tool_result 不能用于配对，因为上游要求紧邻。

### 5. 当前最后一条 user 的 tool_result

当前消息不在 history 中，而是放到 `currentMessage.userInputMessage.userInputMessageContext.toolResults`。

因此需要额外判断：

```text
history 最后一条 assistant tool_use
current user tool_result
```

如果 current user 的 tool_result 能匹配最后一条 history assistant 的 tool_use，则保留并发给上游。

如果不能匹配，则过滤 current tool_result，避免上游 400。

### 6. 最后一条 history assistant 悬空时处理

如果 history 最后一条 assistant 有 tool_use，而 current user 没有对应 tool_result，则移除这些 tool_use。

示例：

```text
history last: assistant tool_use A
current:      user 普通文本
```

修复后：

```text
history last: assistant 普通内容
current:      user 普通文本
```

## 伪代码

```rust
fn repair_tool_use_result_sequence(
    history: &mut Vec<Message>,
    current_tool_results: &[ToolResult],
) -> Vec<ToolResult> {
    let mut result_ids_used_by_current = HashSet::new();

    for i in 0..history.len() {
        if !is_assistant_with_tool_uses(history[i]) {
            continue;
        }

        let expected = assistant_tool_use_ids(history[i]);
        let next_user_results = history.get(i + 1).and_then(as_user_tool_results);

        if let Some(results) = next_user_results {
            let result_ids = ids(results);
            let keep_ids = expected ∩ result_ids;

            retain_assistant_tool_uses(history[i], keep_ids);
            retain_user_tool_results(history[i + 1], keep_ids);
        } else if i + 1 == history.len() {
            let current_ids = ids(current_tool_results);
            let keep_ids = expected ∩ current_ids;

            retain_assistant_tool_uses(history[i], keep_ids);
            result_ids_used_by_current = keep_ids;
        } else {
            remove_all_tool_uses(history[i]);
        }
    }

    current_tool_results
        .iter()
        .filter(|r| result_ids_used_by_current.contains(&r.tool_use_id))
        .cloned()
        .collect()
}
```

实际实现需要注意 Rust 借用关系，建议分两步收集修复计划，再应用修改。

## 需要补充的测试

文件：

```text
src/anthropic/converter.rs
```

建议新增测试：

| 测试名 | 场景 | 期望 |
|---|---|---|
| `repairs_missing_tool_result_in_history` | assistant 有 tool_use，下一条 user 没 result | tool_use 被移除 |
| `keeps_valid_adjacent_tool_pair` | assistant tool_use 紧跟 user tool_result | 原样保留 |
| `drops_late_tool_result` | tool_result 出现在后续 user，不紧邻 | late result 被删除 |
| `keeps_partial_matched_tools_only` | tool_use A/B，只返回 result A | 保留 A，删除 B |
| `drops_extra_tool_result` | user 多出孤立 result C | 删除 C |
| `keeps_current_tool_result_for_last_assistant` | current user result 匹配最后 history assistant | current result 保留 |
| `drops_current_orphan_tool_result` | current result 无对应上一条 assistant tool_use | current result 删除 |
| `does_not_drop_user_text` | user 同时有 text 和非法 tool_result | text 保留 |

## 对用户体验的影响

正常用户链路：

```text
assistant tool_use -> user tool_result
```

不会被修改。

异常链路：

```text
assistant tool_use -> 缺失 tool_result
```

原行为：上游 400，用户任务失败。  
修复后：移除无法完成的工具调用历史，让会话尽量继续。

这属于容错，不是改变正常语义。

## 风险和边界

### 风险 1：删除 tool_use 后模型少了一段工具意图

这是可接受的，因为该 tool_use 本来没有合法结果，上游也不会接受。继续保留只会 400。

### 风险 2：迟到 tool_result 被删除

这是必要的，因为上游要求紧邻配对。迟到结果即使 id 对，也不能合法使用。

### 风险 3：多工具部分结果

只保留有结果的工具调用，可以最大化保留合法信息，同时避免缺失项导致 400。

## 非目标

本方案不做以下事情：

- 不修改真实缓存命中率。
- 不修改模拟缓存逻辑。
- 不修改选号、亲和度、凭据调度。
- 不伪造 tool_result。
- 不改变 sub2/new-api 发来的原始请求协议。
- 不在上游 400 后重试修补。

## 验收标准

1. 构造缺失 tool_result 的请求，本地转换后不再向上游发送孤立 tool_use。
2. 构造迟到 tool_result 的请求，本地转换后不再向上游发送迟到 result。
3. 合法工具链请求转换结果保持不变。
4. 正式环境不再出现同类 `TOOL_USE_RESULT_MISMATCH` 和 `Invalid tool use format` 400。
5. `cargo test converter` 通过。
6. 真实缓存、模拟缓存相关测试不受影响。
