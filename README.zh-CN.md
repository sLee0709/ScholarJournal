# ScholarJournal

[English](README.md) | [中文版](README.zh-CN.md)

**一款适用于 Google Scholar 的 Chrome 扩展，支持期刊指标展示、论文筛选、CSV 导出及研究者发表记录分析。**

ScholarJournal 为 Google Scholar 提供期刊层面的文献计量信息及交互式论文分析功能。系统采用本地优先（local-first）架构，使用用户自行准备的期刊数据库，在本地匹配不足时通过 Crossref 获取文献元数据，无需独立后端服务器。

## 功能介绍

### 期刊指标展示（Journal Metrics）

在搜索结果和研究者个人主页展示期刊名称、影响因子（JIF）、JCR 分区、基于百分位的 Top 百分比、五年影响因子、JCI 和学科排名。采用渐变色辅助比较，并通过详情弹窗展示 ISSN、eISSN、出版商及各学科详细信息。

### 智能期刊识别（Intelligent Journal Identification）

- 期刊全称精确匹配、标准化名称匹配、缩写及 ISSN/eISSN 匹配。
- 从受支持的论文链接提取 DOI 和 ISSN。
- 截断期刊名称的候选识别。
- 本地匹配不足时，通过 DOI、标题和文献检索获取 Crossref 元数据。
- 综合标题、发表年份、出版来源及可用作者信息验证论文身份。
- 在辅助证据充分时验证明确被截断的论文标题。
- 对同标题及不同出版版本的记录进行消歧。
- 记录无法识别及存在歧义的具体原因。

本地匹配无需等待远程请求即可展示。对于不确定的识别结果，不分配确定性的期刊指标。

### Crossref API 访问模式（Crossref API Access）

两种模式均免费，共用元数据缓存与论文识别逻辑。

| 设置 | Public Pool | Polite Pool |
|---|---|---|
| 账号 / API Key | 不需要 | 不需要 |
| 联系邮箱 | 不需要 | 需要 |
| 默认 DOI 请求间隔 | 250 ms | 120 ms |
| 默认标题查询间隔 | 1100 ms | 380 ms |
| 配置的最大并发数 | 1 | 3 |

默认使用 Public Pool。如需启用 Polite Pool，打开扩展程序 Popup，在 **Crossref API Access** 区域输入有效联系邮箱，点击 **Connect to Polite Pool**，确认访问模式后启用增强调度。点击 **Disconnect** 可恢复 Public Pool。这并非账户认证，无需密码或邮箱验证码。

上述间隔为插件默认配置，并非实际吞吐量保证。后台根据响应头调整限制，并在必要时自动退避。

**性能说明：** 大型研究者主页的远程识别仍可能需要数分钟，耗时受到 Crossref 请求限制、响应延迟、重试、补充检索以及缓存命中情况的影响。Polite Pool 支持更高吞吐量，但不保证固定加速倍数。

详见 [Crossref API 访问与认证文档](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)。

### 论文筛选（Publication Filtering）

支持按最低和最高 IF、多选 JCR 分区、期刊名称或缩写、是否保留指标缺失记录等条件筛选已加载的论文。多个条件可以组合，不改变 Google Scholar 原始搜索条件。

### CSV 导出（CSV Export）

导出已加载或筛选后的论文，包括标题、作者、年份、引用次数、可获取的 DOI 和链接、期刊名称及标识符、出版商、期刊指标、学科详情、出版物类型及匹配状态。CSV 使用带 BOM 的 UTF-8 编码，兼容 Excel、R 和 Python。

### 研究者发表记录分析（Researcher Publication Analytics）

分析面板尝试收集研究者完整的公开发表记录，而不是仅分析初始显示的论文。

**全局分析筛选器**
- 全部年份、最近 3/5/10 年、自定义年份范围。
- 按累计引用或近似年均引用排名的 Top N 或 Top 百分比。
- 单个或多个期刊、IF 范围、JCR 分区、引用次数范围及出版物类型。

**总体概览（Overview）**
- 论文数量、不同期刊数量、总引用次数、JCR 匹配覆盖率及 Q1 占比。
- 平均、中位数和最高 IF、年度发文趋势、JCR 及 IF 分布、按发表年份统计当前 IF 的均值、出版物类型分布。

**期刊分析（Journals）**
- 各期刊发文数量、引用统计、IF 及分区。
- 高频发表期刊、年度发文趋势及交互式单期刊分析。

**引用分析（Citations）**
- 引用次数分布及引用集中度曲线。
- Top 10/20 篇及 Top 1%/10% 论文的引用贡献。
- 基于累计引用或近似年均引用的排名。

**论文记录（Papers）**
- 搜索、排序、分页及所选论文或表格筛选结果的 CSV 导出。
- 独立区分出版物类型、论文识别状态及 JCR 数据可用性。
- 识别状态与 JCR 状态筛选、鼠标悬停查看验证详情及搜索失败原因。
- 区分已验证、本地匹配、待识别、推迟识别、存在歧义、未识别及 API 错误等状态。

已确认的期刊论文可能因期刊未被本地数据库收录而缺少 JCR 指标。待识别不等同于识别失败。完整发表记录支持本地缓存，分析过程提供进度、取消、超时提示及部分数据分析选项。

### 自定义设置（Customizable Settings）

通过 Popup 启用或禁用插件、选择展示指标、开关筛选与 Crossref 查询、隐藏未匹配标签、配置可选的 Polite Pool、查看请求频率和并发设置、管理元数据缓存及恢复默认设置。设置保存在本地。

## 安装方法

目前可通过源代码以未打包 Chrome 扩展形式安装。

### 1. 下载项目

```bash
git clone https://github.com/sLee0709/ScholarJournal.git
cd ScholarJournal
```

也可以从 GitHub 下载 ZIP 并解压。

### 2. 安装 Python 依赖

Python 仅用于数据库准备，扩展运行时不需要 Python。

```bash
pip install pandas openpyxl
```

### 3. 准备期刊数据库

**本仓库不分发专有原始数据集或生成的 `journals.js`。** 用户应通过合法授权渠道获取期刊指标，例如通过机构订阅访问 [Web of Science](https://www.webofscience.com/) 和 [Journal Citation Reports](https://jcr.clarivate.com/)，并遵守 [Clarivate](https://clarivate.com/) 的许可及数据使用要求。

#### 3.1 输入文件

将 `2025_journal_info.xlsx` 放在项目根目录，每行对应一条期刊记录。如使用其他文件名，在 `convert.py` 中调整 `INPUT`：

```python
BASE = Path(__file__).resolve().parent
INPUT = BASE / "my_journal_data.xlsx"
OUTPUT = BASE / "journals.js"
```

#### 3.2 配置列名映射

根据实际 Excel 列名调整 `COLUMN_MAP` 的键，保持右侧内部字段名称不变。原始映射使用中文列名：

| 内部字段 | 说明 | 原始 Excel 列名 |
|---|---|---|
| `journal` | 期刊全称 | 期刊名称 |
| `abbreviation` | 期刊缩写 | 期刊缩写 |
| `issn` | 印刷版 ISSN | ISSN |
| `eissn` | 电子版 ISSN | eISSN |
| `publisher` | 出版商 | 出版商 |
| `category` | 学科类别 | 学科类别 |
| `jif` | 影响因子 | 影响因子JIF |
| `quartile` | JCR 分区 | JIF分区 |
| `percentile` | JIF 百分位 | JIF百分位 |
| `rank` | 学科排名 | JIF排名 |
| `jci` | 期刊引文指标 | JCI |
| `jif5` | 五年影响因子 | 5年影响因子 |
| `jif_no_self` | 去自引 JIF | 去自引影响因子 |
| `category_details` | 各学科分区及排名 | 各学科分区详情 |
| `year` | 数据年份或版本 | 数据年份 |

英文列名映射示例（根据实际文件调整）：

```python
COLUMN_MAP = {
    "Journal Name": "journal",
    "Journal Abbreviation": "abbreviation",
    "ISSN": "issn",
    "eISSN": "eissn",
    "Publisher": "publisher",
    "Category": "category",
    "Journal Impact Factor": "jif",
    "JIF Quartile": "quartile",
    "JIF Percentile": "percentile",
    "JIF Rank": "rank",
    "JCI": "jci",
    "5-Year Impact Factor": "jif5",
    "JIF Without Self-Citations": "jif_no_self",
    "Category Details": "category_details",
    "Data Year": "year"
}
```

输入文件必须包含映射中指定的全部列。缺失指标请使用空值列，不要填入人为数值。英文列名仅为示例，并不保证与官方导出表一致。

| 字段 | 格式示例 |
|---|---|
| ISSN / eISSN | `1234-5678` |
| JIF | `8.5` |
| JCR 分区 | `Q1` |
| JIF 百分位 | `95.2` |
| 学科排名 | `5/100` |
| 数据年份 | `2025` |
| 学科详情 | `CATEGORY A(SCIE):Q1 5/100 \| CATEGORY B(SCIE):Q2 20/80` |

多学科期刊应采用一致的规则确定汇总分区、百分位与排名，并在 `category_details` 保留学科级信息。如数据来自多个文件或按学科记录，可能需要预处理。

#### 3.3 生成 `journals.js`

```bash
python convert.py
```

脚本执行名称及 ISSN 标准化、重复记录检测和数据库转换。输出结构示例（不含真实专有指标）：

```javascript
const JOURNALS = [
    {
        "journal": "Example Journal",
        "abbreviation": "EXAMPLE J",
        "issn": "",
        "eissn": "",
        "publisher": "",
        "category": "",
        "jif": "",
        "quartile": "",
        "percentile": "",
        "rank": "",
        "jci": "",
        "jif5": "",
        "jif_no_self": "",
        "category_details": "",
        "year": "",
        "journal_normalized": "example journal",
        "abbreviation_normalized": "example j"
    }
];
```

将生成的 `journals.js` 保留在项目根目录。原始 Excel 与生成数据库均应通过 `.gitignore` 排除在版本控制之外。

#### 3.4 更新期刊数据库

通过授权渠道获取新版数据，调整映射及数据年份，重新运行 `python convert.py`，更新 `popup.html` 中的数据库年份及记录数量，然后重新加载扩展。

### 4. 加载 Chrome 扩展

1. 打开 Chrome 并访问 `chrome://extensions/`。
2. 启用开发者模式（Developer mode）。
3. 点击加载已解压的扩展程序（Load unpacked）。
4. 选择 ScholarJournal 项目目录。
5. 打开或刷新 Google Scholar。

## 使用方法

### 搜索结果页面

打开 [Google Scholar](https://scholar.google.com/) 正常搜索。插件自动展示可获取的期刊指标，点击信息图标查看详情，通过 Filters 筛选，使用 Export CSV 导出。

### 研究者个人主页

插件自动处理已显示及新展开的论文。点击 **Publication Analytics** 加载分析面板；若存在有效完整缓存则直接读取，否则尝试收集完整公开发表记录并进行识别。使用全局筛选器及 Overview、Journals、Citations、Papers 标签页进行分析。Papers 中可进一步按识别及 JCR 状态筛选。

### 扩展程序设置

点击 Chrome 工具栏中的 ScholarJournal 图标，调整显示偏好、管理缓存或配置 Crossref 访问模式，无需重新安装。

## 技术架构

基于 JavaScript、HTML、CSS 和 Chrome Extension Manifest V3，不依赖独立服务器或外部 JavaScript 可视化库。

```text
Google Scholar 元数据
        |
        v
     本地匹配
      /    \
   成功    未匹配
    |        |
    |    Crossref (Public / Polite)
    |        |
    |    标题、年份、来源、作者验证及消歧
    |        |
    |    出版类型识别与 JCR 匹配
    |        |
    +--------+
        |
        v
   指标展示、筛选、导出及分析
```

后台 Service Worker 统一负责请求调度、动态并发控制、限流、重试及持久化缓存。标题缓存索引结合文献上下文，减少同标题同年份的不同出版记录错误共用缓存。身份验证结果与失败原因保存在分析快照中。研究者发表记录收集和远程识别可独立进行。

| 文件 | 说明 |
|---|---|
| `convert.py` | 数据库准备 |
| `journals.js` | 本地生成数据库（不分发） |
| `matcher.js` / `parser.js` | 匹配与元数据解析 |
| `background.js` | Crossref 查询、验证、调度及缓存 |
| `content.js` | 页面集成及识别 |
| `settings.js` | 设置管理 |
| `popup.html` / `popup.js` / `popup.css` | 设置界面 |
| `filters.js` / `export.js` | 筛选及 CSV 导出 |
| `profile_loader.js` / `profile_cache.js` | 发表记录收集及缓存 |
| `analytics.js` | 统计分析 |
| `analytics_ui.js` / `analytics.css` | 交互分析面板 |
| `manifest.json` | 扩展配置 |
| `style.css` | 页面样式 |
| `test.html` | 匹配测试界面 |

## 数据来源

- **Google Scholar：** 公开论文标题、作者、发表年份、引用次数及链接。
- **Crossref：** 用于身份验证的文献元数据，详见 [REST API 文档](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)。
- **用户提供的数据库：** 独立获得授权的期刊指标及排名。

Crossref 不用于获取专有 JIF 或 JCR 排名。

## 隐私说明

用户设置、元数据及发表记录缓存保存在 Chrome 扩展本地存储中。本地识别不足时，论文标题或 DOI 可能发送至 Crossref；可在设置中关闭远程查询。选择 Polite Pool 时，联系邮箱保存在本地，并通过 `mailto` 参数发送至 Crossref。可通过 Disconnect 或恢复默认设置删除邮箱。插件无需注册用户账号，不运营专门的数据收集服务器，也不会主动收集 Google 账户登录凭据。

## 已知局限性（Known Limitations）

- Google Scholar 元数据可能缺失、截断或不规范。
- Crossref 无法覆盖所有论文，部分早期、地区性出版物及其他 DOI 注册机构的记录可能不可检索。
- 当证据不足时，同标题论文及不同版本可能无法消歧。
- 已确认的期刊可能不在本地 JCR 数据库中，指标缺失不等于识别失败。
- 部分分析可能包含待识别记录；远程请求限制及网络延迟可能影响速度。
- 指标来自当前安装的数据库而非发表年份对应的历史 JCR；不应将期刊指标或引用次数直接视为研究质量。

系统优先考虑识别可靠性，而非单纯提高覆盖率；不为无法可靠匹配的记录强行分配指标。

## 数据授权与免责声明

仓库分发实现代码及数据准备脚本，不分发专有 JCR 数据或受限来源的指标。用户应独立获取授权数据并遵守许可协议；没有相应再分发权利时，不应公开生成的数据库。

## 联系与反馈

- 开发者：Li Shen
- GitHub：[sLee0709](https://github.com/sLee0709)
- 项目：[ScholarJournal](https://github.com/sLee0709/ScholarJournal)
- 问题及建议：[GitHub Issues](https://github.com/sLee0709/ScholarJournal/issues)

欢迎科研社区反馈。
