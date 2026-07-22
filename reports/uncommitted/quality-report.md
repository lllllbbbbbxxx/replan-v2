# Replan V2 QA Handoff · 独立测试诊断报告

> ⚠️ **报告目录说明**：规范 §9 / Playbook §5 要求报告目录与 artifact 名称包含 commit SHA，
> 并禁止复用旧报告。当前仓库虽已 `git init`（分支 `main`），但 **0 次提交**（HEAD 未诞生、
> 所有文件 untracked），**无法绑定 commit SHA**，故临时落盘于 `reports/uncommitted/`。
> 产生首次提交后，应将本目录重命名为 `reports/<short-sha>/` 并重新绑定。

| 项 | 值 |
|---|---|
| Product | Replan V2 / Replan MVP (`replan-mvp@0.1.0`) |
| Spec | REPLAN-V2-MVP-ACCEPTANCE v2.0（sha256 `487a616a223ba5a8b36c22fad19b36d62e6bf7c89e1c27eb0487b1fe0db08d31`） |
| Playbook | REPLAN-V2-QA-AI v2.0（sha256 `abfe217cf3f2d567f26ae47a75a6d27361e9138e77c7bad443959c9645efe2fe`） |
| Commit | ⚠️ 无（仓库 0 提交，HEAD 未诞生） |
| Branch | `main` |
| Working tree | dirty（全部未跟踪） |
| Test mode | deterministic — 固定时钟 `2026-08-03`（以纯函数入参注入）+ 等价 fixture 步骤，未访问真实 LLM |
| Overall status | 7 PASS / 1 FAIL(P2) / 0 P0 / 0 P1；核心链路可用，存在阻碍“作为门禁运行”的可测性缺口，合并需人工确认 |

---

## 0. 规范完整性检查（Playbook §5）

| 检查项 | 结果 | 说明 |
|---|---|---|
| 被测产品版本 | ✅ Replan V2 / Replan MVP | 与规范“适用产品”一致 |
| 验收规范版本 | ✅ REPLAN-V2-MVP-ACCEPTANCE v2.0 | 显式取代 v1.0（AI 日程管家，已停用） |
| 用例数量 = 8 | ✅ 采集到 V2-MVP-01…08，共 8 | 满足规范 §9“少于 8 直接失败” |
| 无 BASELINE_MISMATCH | ✅ | v2.0 已把基线收束到当前产品，不再套用 V1（NL deadline / 每日 4h / is_feasible / 服务端持久化均列为范围外） |
| commit SHA 绑定 | ⚠️ WARN | 无提交，无法把报告绑定到 SHA——记为完整性告警，非 MISMATCH |
| LLM fixture + 固定时钟门禁 | ⚠️ TESTABILITY_GAP | 见 §3 |

结论：基线匹配，**可进入 P0/P1/P2 判定**（与上一轮 v1.0 因产品定义冲突整体 BASELINE_MISMATCH 终止不同）。

---

## 1. 汇总（8 固定用例）

| 用例 | 主题 | 结果 | 严重度 | 依据不变量 | 验证方式 |
|---|---|---|---|---|---|
| V2-MVP-01 | 明确 deadline 创建计划 · 2/2/2 | ✅ PASS | — | INV-01/04/05 | 纯函数取证 |
| V2-MVP-02 | 截止日期必填 | ✅ PASS | — | INV-01 | 代码审查 |
| V2-MVP-03 | 七日窗口含边界，不越到 8/10 | ✅ PASS | — | INV-05 | 纯函数取证 |
| V2-MVP-04 | 步骤 schema 与 15–240 粒度 | ✅ PASS | — | INV-02/03 | 纯函数+schema |
| V2-MVP-05 | 均摊而非固定容量（单日可 >4h） | ✅ PASS | — | INV-06 | 纯函数取证 |
| V2-MVP-06 | 标记完成与进度 1/6 | ✅ PASS | — | INV-07 | 代码审查 |
| **V2-MVP-07** | **重复完成幂等** | **❌ FAIL** | **P2** | **INV-07** | 代码审查 |
| V2-MVP-08 | 同一浏览器本地恢复 | ✅ PASS | — | INV-08 | 代码审查 |

**关键取证（固定今天 = 2026-08-03，纯函数 `scheduleSteps`）：**

```
V2-MVP-01 dates: [08-03, 08-03, 08-04, 08-04, 08-05, 08-05]
           dist : {08-03: 2步/120m, 08-04: 2步/120m, 08-05: 2步/120m}  → 2/2/2 ✅
           ids  : 6/6 唯一 ✅
V2-MVP-03 dates: [08-03 … 08-09] 共 7 天，每天 1 步，hasAug10 = false ✅
V2-MVP-04 durations: [15, 45, 120, 240] 全部 ∈ [15,240]，4 步全收，标题非空 ✅
V2-MVP-05 dates: [08-03, 08-03, 08-04, 08-04]  dist: 08-03=480m / 08-04=480m
           → 2/2，单日 480 分钟(8h) 不判失败 ✅
Legacy 字段 is_feasible / isFeasible：不存在 ✅（满足 INV-06）
npm test：8/8 通过（既有单测）
```

---

## 2. 唯一 FAIL 明细

### Issue V2-MVP-07 — 完成操作是「切换」而非「幂等完成」

- **Severity:** P2
- **Acceptance rule:** 规范 §6 V2-MVP-07 +「正确结果：状态保持 completed；完成数仍为 1/6，不得变为 2/6」；INV-07「重复完成请求不得重复累计」；§2 产品契约「重复操作幂等」
- **Reproduction:** 生成 6 步计划 → 点击第一步完成（1/6）→ **再次点击同一步一次**
- **Expected:** 该步仍为 completed，完成数仍 **1/6**
- **Actual:** 该步被切换回未完成，完成数变为 **0/6**（再点一次才回到 1/6）
- **First divergence:** 状态更新层 —— `app/page.tsx` 的 `toggleStep`（约 L166–L179）使用 `completed: !step.completed`（切换），非“置为已完成”的幂等写入
- **Confirmed facts:** 计数永远不会到 **2/6**、不会产生重复步骤或重复完成记录（规范担心的“重复累计”未发生）；但“再次点击保持 completed / 1/6”这一书面预期被违反
- **Suspected root cause:** 复选框天然是 toggle；产品用同一控件同时承担“完成”和“撤销完成”
- **Likely files/functions:** `app/page.tsx` `toggleStep`（如需幂等完成，可拆分“标记完成=置 true”与“撤销”两个意图，或对“完成”事件做幂等 set）
- **Required regression test:** 单元/E2E：对已完成步骤重复触发完成事件 N 次，断言 `completedCount` 恒为 1、无重复记录
- **Non-goals / must not change:** 不得借此引入 V1 的任何字段；不改均摊策略
- **⚠️ Human confirmation required（Playbook §13）:** 复选框“再次点击 = 撤销”属常见交互；是否要求“完成”严格幂等（= 当前 §6/§2 文字），还是接受 toggle 语义并改写 MVP-07 措辞，需**产品负责人裁决**。裁决前按规范书面文字判 FAIL/P2，不上交 Codex 直接改动。

---

## 3. 可测性缺口（TESTABILITY_GAP · 非产品缺陷，不判 P0/P1）

规范 §4 与 Playbook §5/§7/§9 要求“确定性硬门禁 = 固定时钟 + LLM fixture + 浏览器 E2E”。当前实现缺少运行门禁所需的钩子：

1. **无 LLM fixture/mock 模式** —— `app/api/plan/route.ts`（约 L127–L160）恒调用真实 DeepSeek，无环境开关。V2-MVP-01/02/03/04 的 API 契约 E2E 无法脱离真实模型确定性运行（本轮用纯函数验证了其中排程/schema 部分）。
2. **无时钟注入** —— 前端 `app/page.tsx:76` 与 `route.ts:215` 直接用 `new Date()`，无法把 app/API 的“今天”钉到 `2026-08-03`（§4：不能固定时钟 → 标记 TESTABILITY_GAP）。
3. **无验收测试基础设施** —— 无 `spec/acceptance_cases.yaml`、无 `tests/acceptance/`、无 Playwright。MVP-06/07/08 的浏览器 E2E 本轮仅以代码审查确认，浏览器层记为 BLOCKED（无 harness）。
4. **无 commit** —— 报告无法绑定 SHA（§9 / §5）。

> 这些是门禁工程缺口，不是 V1 遗留、也不构成 NOT_APPLICABLE 的产品缺陷；按 Playbook 不得伪装成代码 Bug 交给 Codex，需人工先补齐 harness。

---

## 4. 发布门槛核对（规范 §10）

- ✅ 产品版本 = Replan V2　✅ 规范 = REPLAN-V2-MVP-ACCEPTANCE v2.0
- ⚠️ 8/8 确定性案例通过：逻辑层 7/8 通过，1 项 FAIL(P2)，且门禁尚不能作为 CI 运行（§3）
- ⛔ 浏览器主链路通过：未由自动 E2E 证实（无 harness）
- ⚠️ 无 P0/P1 未处理：无 P0/P1；有 1 个 P2 待裁决
- ⬜ 真实 LLM 质量报告（非门禁）：未跑
- ⬜ 人工完成“创建 → 完成 → 刷新恢复”：待人工
- ✅ PR 未修改规范、未偷偷引入 Legacy V1

**Merge recommendation:** wait for human acceptance —— 先由产品负责人对 V2-MVP-07（幂等 vs toggle）裁决，并补齐固定时钟 + LLM fixture + 浏览器 E2E 门禁；本报告不自行宣布通过（Playbook §12）。

---

## 交接说明

- 可上交 Codex 的确定性 FAIL：**仅 V2-MVP-07**（且建议先拿到产品裁决，避免把 toggle 误改成不可撤销）。
- TESTABILITY_GAP（§3）与 commit 缺失属人工/工程侧，不作为代码缺陷交接。
- 交接前最后检查（Playbook 附录 C）：Product/Spec 已确认、Commit 待补；交接项为 FAIL 而非 NOT_APPLICABLE/SPEC_GAP/BASELINE_MISMATCH；修复范围未引入 Legacy V1；已写明回归测试与非目标。
