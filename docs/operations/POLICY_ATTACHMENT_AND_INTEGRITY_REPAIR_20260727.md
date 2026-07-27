# 政策解析终端附件与完整性修复报告

状态日期：2026-07-27
实施基线：`origin/main` at `14517524edc6a114a961b776558cbe6ec5500a24`
实施方式：隔离工作树，不覆盖原始脏工作区，不执行数据库迁移

## 一、问题与根因

### 1. 同一官方URL可形成多个policy ID

采集端旧逻辑只选择 `contentHash || dedupeKey || canonicalSourceUrl` 中第一个可用键。相同官方URL如果正文长度、正文哈希或标题归一化不同，会按不同content hash进入两条候选。

入库端旧逻辑只查询 `dedupe_key` 和 `content_hash`，没有先按规范化 `canonical_source_url` 和 `source_url` 查重，也不能识别同一政策经不同官方入口镜像发布的情况。

### 2. 附件获取不完整

旧附件逻辑存在三个限制：

1. 只有正文短于1200字或明显是发布外壳时才检查附件；
2. 只识别PDF和OFD链接；
3. 实际只提取PDF，OFD、DOC、XLS等格式无法保留完整研究证据。

因此“正文较长但附件包含名单、项目清单、指标表”的政策会漏采附件。

### 3. 相关解读被误识别为附件

真实发改委页面演练显示，宽泛标题规则会把“答记者问”和“一图读懂”当成HTML附件，导致二次解读混入一手政策证据。

### 4. 静态状态文档与实时收件箱脱节

动态数量被人工复制到静态文档，随着小时采集和人工处置持续变化，静态数字很快失效，无法证明快照时点和查询窗口。

### 5. 中文JSON在Windows/Git Bash链路显示乱码

Artifact内UTF-8 JSON完整，但直接经Windows/Git Bash标准输出显示时受代码页和管道环境影响。问题属于显示层，不是数据库数据损坏。

### 6. 工作流错误被 `tee` 掩盖

`set-manual-policy-disposition.yml` 等工作流使用 `command | tee file`，但没有启用 `pipefail`。上游命令返回409时，`tee`仍返回0，GitHub Actions把失败显示为成功。

### 7. 历史开放任务阻挡状态收口

部分历史政策处于“metadata仍为待审阅，但analysis_jobs存在queued/fetching/extracting/analyzing任务”的不一致状态。控制面按安全规则拒绝直接等待或归档，但旧系统没有显式关闭历史任务的受控入口。

### 8. 构建期依赖高危告警

PostCSS 8.5.14受到GHSA-r28c-9q8g-f849影响。该问题与政策逻辑无关，但会阻断安全发布门。

### 9. HTTP 200伪成功页和零附件误放行

车辆目录生产canary `30269818377` 中，工信部官方镜像返回HTTP 200，但响应体只有42字：`信息模板页面配置实体不能为空`。旧证据收集器把它当作成功页面；由于页面没有附件链接，又把“零附件”解释为“无需附件”，最终错误放行了正式分析。

根因包括两层：

1. 只检查HTTP状态，不检查官方页面字节数、HTML结构和已知错误模板；
2. 发布外壳明确写有附件文件名，或短通知标题为“关于印发《…》”，但附件发现数量为0时，没有强制缺证状态。

### 10. 人工处置状态与政策状态脱节，原因参数被截断

政策从 `selected_for_analysis` 退回 `pending_review` 或 `awaiting_evidence` 后，metadata已变化，但 `policies.status` 仍残留 `reviewing`，造成同一政策在业务状态和人工队列中表达不一致。

同时，人工控制CLI按所有等号执行 `split("=")`。当原因包含 `attachment_review_completed=true` 时，第二个等号之后的文字被静默丢弃，生产快照只留下截断原因。

## 二、实施修复

### 1. 多键政策身份与去重

新增统一政策身份模块：

- `scripts/lib/policy-identity.mjs`
- `supabase/functions/_shared/policyIdentity.ts`

去重顺序调整为：

1. 规范化官方URL；
2. 规范化政策文号；
3. 发布日期＋《》内核心文件标题；
4. 原dedupe key；
5. 正文content hash。

采集端在任意身份键相交时只保留一个canonical；优先保留附件完整、正文更长和来源优先级更高的候选。

入库端先按 `canonical_source_url`、`source_url` 查重，再按dedupe key/content hash查重，最后在同发布日期范围内按政策文号或核心文件标题识别跨来源镜像。

### 2. 全格式附件获取

附件模块升级为：

- 无论页面正文长短，都检查页面声明附件；
- 支持anchor、iframe、embed、object及常见data属性；
- 识别PDF、OFD、DOC/DOCX、XLS/XLSX、PPT/PPTX、CSV、TXT、JSON、XML、HTML、ZIP及常见图片/扫描件；
- PDF、DOCX、XLSX、PPTX、OFD、文本和ZIP可提取文字；
- 旧DOC/XLS/PPT即使不能可靠解析，也下载原文件并标记人工复核；
- 每个附件记录最终URL、类型、字节数、SHA-256、下载状态、提取状态和归档路径；
- 默认小时采集最多32个附件，正式证据包最多64个；超过上限必须标记证据不完整，不能静默截断；
- 单文件和总下载量均有安全上限。

### 3. 一手政策附件与相关解读分离

附件识别明确排除：

- 政策解读；
- 答记者问；
- 一图读懂和图解；
- 新闻发布和访谈页面；
- 常见 `/jd/`、`/zctj/`、`/jiedu/` 路径。

同一正文的PDF、OFD等多格式原件全部保存，但证据文本只纳入一次，避免重复放大正文。

### 4. 正式分析证据包

新增：

- `scripts/fetch-policy-evidence-package.mjs`
- npm命令 `manual:evidence`

正式取件工作流现在生成：

```text
manual-policy.json
source-page.html
source-page.txt
evidence.txt
manifest.json
attachments/<原始附件文件>
```

`manifest.json`记录正文和全部附件的完整性状态。附件下载失败、发现数量被截断、发布外壳没有取得附件正文，或旧DOC/XLS/PPT、扫描件等仍需人工阅读时：

1. 证据包仍上传；
2. 已启动政策显式关闭本次开放任务并自动退回 `awaiting_evidence`，不得把“原件已下载但尚未读懂”当作证据完整；
3. 对旧DOC/XLS/PPT、扫描件等已下载原件，人工核验完成后必须以 `attachment_review_completed=true` 显式确认；
4. 工作流明确失败，不继续正式分析。

### 5. 动态生产快照

生产运行摘要升级为 `production-operations-summary-v3`，每天00:35 UTC自动生成，包含：

- `asOf`；
- GitHub workflow run ID和attempt；
- 查询窗口；
- 主定时采集运行和最大主定时间隔；
- 实际执行补采的恢复工作流运行；
- 远程存活链的最近状态和当前活动状态；
- 最近一次有效采集、有效采集年龄和 `healthy/degraded/stale/unknown` 健康判断；
- 当前/历史收件箱状态；
- 精确URL重复组和语义重复组；
- 附件待证数量；
- 正式报告数量。

其中，最近有效采集由成功主定时采集和已确认实际执行补采的恢复运行共同计算。主定时最大间隔仅描述GitHub定时投递，不单独等同于生产采集中断。静态文档明确不再作为实时数量权威源。

### 6. 跨平台JSON输出

新增ASCII-safe JSON输出模块。Windows或非TTY管道默认输出 `\uXXXX` 转义，但JSON语义不变；需要人工阅读时可显式使用 `--unicodeJson=true`。

### 7. 工作流失败传播

所有使用 `| tee` 的工作流步骤均加入：

```bash
set -euo pipefail
```

上游命令失败将正确使GitHub Actions失败。

### 8. 显式关闭历史开放任务

`analyze`控制面新增 `closeOpenJob=true`：

- 仅管理员显式调用；
- 必须提供至少4个字符的原因；
- 仅在改变为等待、归档、关闭等非选择状态时使用；
- 将该政策全部开放任务标记为 `failed`、进度100、记录结束时间和错误原因；
- 随后再更新政策人工处置状态；
- 默认仍拒绝带开放任务的状态修改，不自动取消。

对应CLI参数：

```text
--closeOpenJob=true
```

对应GitHub workflow输入：

```text
close_open_job: true
```

### 9. 构建依赖安全修复

通过npm override将PostCSS锁定为8.5.18。重新安装后 `npm audit --audit-level=high` 为0漏洞。

### 10. 官方页面有效性和零附件硬门

新增 `scripts/lib/policy-page-validation.mjs`：

- 官方政策页少于200字节时拒绝；
- 命中“信息模板页面配置实体不能为空”、Access Denied、Forbidden等错误模板时拒绝；
- 不包含可识别HTML结构时拒绝；
- 工信部主站或镜像返回伪200时继续尝试下一官方镜像，全部失败才结束取件。

附件完整性门新增：

- 正文尾部明确声明 `.pdf/.ofd/.doc/.xlsx` 等附件文件，但发现0个链接时，状态为 `attachmentCollectionStatus=missing`；
- 短“现将《…》印发给你们”发布外壳或“关于印发《…》”短通知，发现0个附件时进入缺证；
- 附件URL返回HTML错误页时，不归档为DOC/PDF原件，而是标记下载失败；
- 真实PDF、OLE旧Office、ZIP/OOXML和图片魔数优先于错误的响应头，避免服务器误标 `text/html` 导致误拒绝。

### 11. 状态同步和长参数解析

`setManualReviewDisposition` 现在同时维护政策业务状态：

- 选择分析时，`draft → reviewing`；
- 从选择状态退回待审、待证、归档或关闭时，`reviewing → draft`；
- 已发布政策不被回退。

新增共享CLI参数解析器，只按第一个等号切分长参数；原因、确认令牌和其他值中后续所有等号均原样保留。人工控制CLI和批量重分析CLI共同使用该实现。

## 三、真实一手证据验证

### 可再生能源发展“十五五”规划

正式发改委页面验证结果：

- 真正附件：PDF、OFD各1份；
- 两份均下载成功并提取；
- PDF SHA-256：`70faf2905e63f2970f6bc938bc141d3193dd9ab295235da8a619d56708bde9cb`；
- OFD SHA-256：`8c1ead00de1fdb9f30b40d53fa05d92e9933afef319db762c8079d46f2ccdfab`；
- “答记者问”和“一图读懂”已正确排除；
- PDF/OFD原件均保留，正文证据只纳入一次；
- 证据完整性：`complete / all_extracted / incomplete=false`。

### 非化石能源电力消费核算指南（试行）

发改委原始页：

- PDF、OFD各1份；
- 两份均下载并提取；
- PDF SHA-256：`c3d78a4b091d9e4c805a55e7ff8457c98e17775e719d4e54b9620ba13b5ce2c1`；
- OFD SHA-256：`2f47403001c61c6acc266392a192d92e90353943f7d95a8f7c1d981331deb726`；
- 合并证据正文约6491字符。

国家数据局镜像页：

- 仅约480字转发外壳；
- 未声明或提供附件。

因此canonical应为发改委policy ID `a02f8c45-22f1-4bed-ad57-a737513d1752`。

## 四、生产数据处置

### 已完成

同一网络安全保险政策的短正文重复候选：

- duplicate：`abea591c-268c-4fc0-9656-7e2e391b6982`；
- canonical：`c769ab9c-b3f9-4912-a1c5-8f3b3ee5e881`；
- 处置工作流run：`30262946881`；
- 结果：duplicate已从收件箱移出，生产候选由82项降为81项，精确URL重复组由1降为0。

### 历史开放任务和跨来源镜像已收口

新版控制面发布后，按 `close_open_job=true` 分页关闭全部遗留任务：

- 国家数据局镜像累计关闭283个开放任务并dismiss；
- 发改委canonical累计关闭284个开放任务；
- 幂等复核run `30267980779`、`30267986173` 均返回 `closedJobCount=0`；
- 发改委canonical正向canary run `30268103348` 成功，新建唯一分析任务并完整取得PDF/OFD；
- 国家数据局镜像不再进入收件箱和正式分析。

车辆目录旧DOC反向canary run `30268293117` 下载了3个原始DOC、关闭本次新任务并退回等待证据；随后run `30269818377` 暴露工信部伪200零附件误放行问题，已由“官方页面有效性和零附件硬门”修复。

所有处置均通过Edge控制面和GitHub工作流完成，没有绕过审计直接修改数据库。

## 五、验证结果

已通过：

- 政策身份与多键去重测试；
- 长正文附件采集测试；
- PDF、OFD、DOCX、XLSX、PPTX、文本和ZIP提取测试；
- 旧DOC原件保留及人工复核测试；
- 解读/图解排除测试；
- 多格式正文去重测试；
- 正式证据包原文件归档测试；
- 小时采集、恢复守卫和手工选择合同；
- 动态生产摘要manifest测试；
- 跨平台JSON输出测试；
- GitHub workflow安全和pipefail合同；
- `ingest`/`analyze` Edge类型检查；
- 前端生产构建与bundle预算；
- PostCSS安全修复后npm audit 0漏洞；
- 官方页面伪200、短错误页和无HTML结构拒绝测试；
- 发布外壳声明附件但发现0链接的硬阻断测试；
- 附件URL返回HTML错误页拒绝测试；
- 二进制文件魔数优先于错误Content-Type测试。

## 六、部署边界

本次没有数据库迁移。代码必须先进入远程主分支，再部署：

- `ingest`：启用多键去重和附件完整性元数据；
- `analyze`：启用受控旧任务关闭；
- GitHub workflows：启用证据包、附件门、pipefail和每日生产快照。

部署后先做两项canary：

1. 使用完整附件政策验证“选择—证据包—保持selected”；
2. 使用缺附件政策验证“选择—证据包失败—自动退回awaiting_evidence”。
