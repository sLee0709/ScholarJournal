# ScholarJournal

[English](README.md) | [中文版](README.zh-CN.md)

**一款适用于 Google Scholar 的 Chrome 扩展，支持期刊指标展示、论文筛选及研究者发表记录分析。**

ScholarJournal 是一款轻量级科研辅助工具，旨在为 Google Scholar 提供期刊层面的文献计量指标与交互式论文分析功能，帮助研究人员探索学术文献、识别发表期刊、根据期刊指标筛选论文、导出文献数据，以及分析研究者的发表记录。

ScholarJournal 采用本地优先（local-first）架构，主要通过本地生成的期刊数据库进行期刊识别。当本地匹配无法确认期刊时，使用 Crossref 获取补充元数据。

无需部署独立的后端服务器。

## 功能介绍

### 期刊指标展示（Journal Metrics）

在 Google Scholar 搜索结果页面和研究者个人主页直接展示以下期刊信息：

- 期刊名称
- 期刊影响因子（JIF）
- Journal Citation Reports（JCR）分区
- 基于 JIF 百分位计算的 Top 百分比
- 五年影响因子
- 期刊引文指标（JCI）
- 期刊学科排名

期刊指标采用渐变色展示，便于直观比较。通过交互式详情弹窗，还可以查看 ISSN、eISSN、出版商及各学科的具体排名等信息。

### 智能期刊识别（Intelligent Journal Identification）

ScholarJournal 采用多种互补的期刊匹配策略：

- 期刊全称精确匹配及标准化名称匹配
- 期刊缩写匹配
- ISSN 和 eISSN 匹配
- 从论文链接中提取 DOI 和 ISSN
- 基于 DOI 或论文标题获取 Crossref 元数据
- 截断期刊名称的候选期刊识别

本地匹配与远程元数据查询相互独立，本地成功匹配的期刊信息无需等待外部 API 请求即可显示。

**性能说明：** 期刊识别及研究者发表记录分析有时可能耗时较长，尤其是在大量论文需要通过 Crossref 获取元数据时。这是因为 ScholarJournal 主动限制请求频率和并发数量，以遵守 Crossref API 的使用限制。

对于无法确认的匹配结果，不展示确定性的期刊指标。

### 论文筛选（Publication Filtering）

在 Google Scholar 搜索结果页面和研究者个人主页中直接使用以下条件筛选论文：

- 最低和最高影响因子
- 多选 JCR 分区
- 期刊名称或缩写
- 是否保留缺失期刊指标的论文

多个筛选条件可以组合使用。筛选仅作用于当前已加载的论文，不会修改 Google Scholar 原始搜索条件。

### CSV 导出（CSV Export）

支持将当前已加载的全部论文或筛选后的论文导出为 CSV 文件，包括：

- 论文标题、作者、发表年份及引用次数
- DOI 和论文链接（如可获取）
- 期刊名称、缩写、ISSN、eISSN 及出版商
- JIF、JCR 分区、百分位、五年 JIF 及 JCI
- 学科排名及详细学科分类信息
- 出版物类型及匹配状态

CSV 文件采用带 BOM 的 UTF-8 编码，兼容 Excel、R、Python 及其他数据分析工具。

### 研究者发表记录分析（Researcher Publication Analytics）

ScholarJournal 在 Google Scholar 研究者个人主页中提供独立的交互式分析面板。

与仅分析初始显示论文的方式不同，ScholarJournal 会尝试在分析之前加载研究者完整的公开发表记录。

分析面板支持以下功能：

**全局分析筛选器**

- 全部发表记录
- 最近 3、5 或 10 年的论文
- 自定义发表年份范围
- 引用次数最高的前 N 篇论文
- 按引用次数排名的前若干百分比论文
- 按累计引用次数或近似年均引用次数排序
- 单个或多个期刊选择
- 影响因子范围
- JCR 分区
- 引用次数范围
- 出版物类型

**总体概览（Overview）**

- 论文总数及不同期刊数量
- 总引用次数
- 期刊数据库匹配覆盖率
- Q1 论文占比
- 平均、中位数及最高影响因子
- 年度发文趋势
- JCR 分区分布
- 影响因子分布
- 按发表年份统计当前期刊指标的分布
- 出版物类型分布

**期刊分析（Journals）**

- 发文数量最多的期刊
- 各期刊发文数量
- 各期刊引用统计
- 期刊影响因子及分区
- 单个期刊的年度发文趋势
- 交互式期刊选择与分析

**引用分析（Citations）**

- 引用次数分布
- 引用集中度曲线
- 高被引论文的引用贡献
- 引用次数最高的前 10 篇及前 20 篇论文
- Top 1% 和 Top 10% 论文的引用贡献
- 基于累计引用次数或年均引用次数的排名

**论文记录（Papers）**

- 支持搜索和排序的论文表格
- 按论文标题、作者及期刊搜索
- 按发表年份、影响因子、分区及引用次数排序
- 大规模论文数据的分页展示
- 所选论文记录的 CSV 导出

完整的研究者发表记录可以缓存在本地，避免重复收集数据。加载过程中提供进度显示、取消操作及发表记录不完整时的提示。

### 自定义设置（Customizable Settings）

通过扩展程序的 Popup 设置界面，用户可以：

- 启用或禁用 ScholarJournal
- 选择需要展示的期刊指标
- 启用或禁用论文筛选工具栏
- 隐藏未匹配的期刊标签
- 启用或禁用 Crossref 元数据查询
- 管理 Crossref 元数据缓存
- 恢复默认设置

设置会自动保存在本地，并应用于受支持的 Google Scholar 页面。

## 安装方法

ScholarJournal 目前以源代码形式提供，可以作为未打包的 Chrome 扩展手动安装。

### 1. 下载项目

```bash
git clone https://github.com/sLee0709/ScholarJournal.git
cd ScholarJournal
```

也可以直接从 GitHub 下载 ZIP 压缩包并解压到本地。

### 2. 安装 Python 依赖

Python 仅用于准备本地期刊数据库，Chrome 扩展本身运行时不需要 Python。

安装所需的 Python 库：

```bash
pip install pandas openpyxl
```

### 3. 准备期刊数据库

**重要：本仓库不提供原始期刊指标数据集，也不提供生成后的 `journals.js` 数据库。**

用户需要通过合法且获得授权的渠道自行获取期刊指标数据，例如通过 Web of Science 或获得授权的机构订阅访问 Clarivate 的 Journal Citation Reports（JCR）。

官方资源：

- [Web of Science](https://www.webofscience.com/)
- [Journal Citation Reports](https://jcr.clarivate.com/)
- [Clarivate](https://clarivate.com/)

用户应确保期刊指标的获取、处理和本地使用符合相关许可协议及数据使用政策。

#### 3.1 准备输入文件

提供的 `convert.py` 脚本默认读取以下 Excel 文件：

```text
2025_journal_info.xlsx
```

将 Excel 文件放在 ScholarJournal 项目的根目录下。

如果你的数据集使用其他文件名，请修改 `convert.py` 中的 `INPUT` 变量：

```python
BASE = Path(__file__).resolve().parent
INPUT = BASE / "2025_journal_info.xlsx"
OUTPUT = BASE / "journals.js"
```

例如：

```python
INPUT = BASE / "my_journal_data.xlsx"
```

输入文件中每一行应对应一条期刊记录。

#### 3.2 配置列名映射

原始转换脚本基于具有中文列名的 Excel 数据集开发。如果你的数据集使用英文列名或其他命名方式，请根据实际 Excel 文件中的列名修改 `convert.py` 中的 `COLUMN_MAP`。

字典的键（左侧）对应原始 Excel 列名，值（右侧）对应 ScholarJournal 使用的内部字段名称。

| 内部字段 | 说明 | 原始 Excel 列名 |
|---|---|---|
| `journal` | 期刊全称 | 期刊名称 |
| `abbreviation` | 期刊缩写 | 期刊缩写 |
| `issn` | 印刷版 ISSN | ISSN |
| `eissn` | 电子版 ISSN | eISSN |
| `publisher` | 出版商 | 出版商 |
| `category` | 学科类别 | 学科类别 |
| `jif` | 期刊影响因子 | 影响因子JIF |
| `quartile` | JCR 分区 | JIF分区 |
| `percentile` | JIF 百分位 | JIF百分位 |
| `rank` | JIF 学科排名 | JIF排名 |
| `jci` | 期刊引文指标 | JCI |
| `jif5` | 五年影响因子 | 5年影响因子 |
| `jif_no_self` | 排除期刊自引的 JIF | 去自引影响因子 |
| `category_details` | 各学科的具体分区及排名 | 各学科分区详情 |
| `year` | 期刊指标数据年份或发布版本 | 数据年份 |

例如，如果 Excel 文件使用英文列名，可以参考以下映射方式：

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

上述英文列名仅为示例，不一定与官方 JCR 导出文件的列名完全一致，请根据自己的数据集进行调整。

为确保与扩展程序兼容，请保持字典右侧的内部字段名称不变。

当前转换脚本要求输入 Excel 文件包含 `COLUMN_MAP` 中指定的全部列。如果某些指标无法获取，请创建对应的空值列，而不要填入人为设定的数值。

推荐的数据格式：

| 字段 | 格式示例 |
|---|---|
| ISSN / eISSN | `1234-5678` |
| JIF | `8.5` |
| JCR 分区 | `Q1` |
| JIF 百分位 | `95.2` |
| 学科排名 | `5/100` |
| 数据年份 | `2025` |
| 学科详情 | `CATEGORY A(SCIE):Q1 5/100 \| CATEGORY B(SCIE):Q2 20/80` |

对于属于多个 JCR 学科类别的期刊，用户应采用一致的规则确定汇总分区、百分位和排名字段。各学科的具体信息可以保留在 `category_details` 中。

如果所需指标分布在多个文件中，或者原始数据以学科为单位记录，运行转换脚本前可能需要额外的数据预处理。

#### 3.3 生成 `journals.js`

运行：

```bash
python convert.py
```

转换脚本会执行期刊名称标准化、ISSN 标准化、重复记录检测，并将 Excel 数据集转换为 JavaScript 兼容的数据库。

生成的文件为：

```text
journals.js
```

生成的数据库采用以下结构：

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

上述示例不包含任何实际的专有期刊指标数据。

请将生成的 `journals.js` 保留在项目根目录下。

原始 Excel 文件及生成的数据库均通过 `.gitignore` 排除在版本控制之外。

#### 3.4 更新期刊数据库

后续如需更新期刊指标：

1. 通过获得授权的渠道获取新版数据集。
2. 准备 Excel 文件，并根据需要调整 `COLUMN_MAP`。
3. 更新数据年份或发布版本信息。
4. 重新运行 `python convert.py`。
5. 重新加载 Chrome 扩展。

同时，应更新 `popup.html` 中显示的数据库年份及期刊记录数量，使其与新版数据集保持一致。

### 4. 加载 Chrome 扩展

生成 `journals.js` 后：

1. 打开 Google Chrome。
2. 在地址栏访问 `chrome://extensions/`。
3. 启用 **开发者模式（Developer mode）**。
4. 点击 **加载已解压的扩展程序（Load unpacked）**。
5. 选择 ScholarJournal 项目目录。
6. 打开或刷新 Google Scholar 页面。

此时，扩展程序应当能够在受支持的论文旁显示相应的期刊信息。

## 使用方法

### Google Scholar 搜索结果页面

打开 [Google Scholar](https://scholar.google.com/)，正常进行文献搜索。

ScholarJournal 会自动识别论文的发表期刊，并在每篇论文的文献信息下方显示可用的期刊指标。

点击信息图标即可查看期刊的详细指标。

使用 ScholarJournal Filters 工具栏，可以按照影响因子、JCR 分区或期刊名称筛选论文。Export CSV 功能支持导出当前已加载的全部论文或筛选后的结果。

### 研究者个人主页

打开任意 Google Scholar 研究者个人主页。

ScholarJournal 会自动为已显示的论文添加期刊指标。当 Google Scholar 的论文列表展开时，新加载的论文也会被处理。

点击 **Publication Analytics**，打开研究者发表记录分析面板。

如果本地存在有效的完整 Profile 缓存，分析面板可以直接读取此前收集的数据。否则，ScholarJournal 会尝试加载研究者完整的公开发表记录，并识别相应的期刊。

数据准备完成后，可以使用全局分析筛选器，并在 Overview、Journals、Citations 和 Papers 四个标签页之间切换。

### 扩展程序设置

点击 Chrome 工具栏中的 ScholarJournal 图标，打开 Popup 设置界面。

无需重新安装扩展程序，即可调整指标展示偏好和其他设置。

## 技术架构

ScholarJournal 基于 JavaScript、HTML、CSS 和 Chrome Extension Manifest V3 实现。

扩展程序无需独立后端服务器，也不依赖外部 JavaScript 可视化库。

期刊识别的总体流程如下：

```text
Google Scholar 论文信息
           |
           v
       论文元数据解析
           |
           v
        本地期刊识别
           |
       是否成功匹配？
        /        \
       是         否
       |           |
       |     Crossref 元数据查询
       |           |
       |       本地数据库匹配
       |           |
       +-----------+
           |
           v
     期刊指标与科研辅助功能
```

主要功能模块如下：

| 文件 | 说明 |
|---|---|
| `convert.py` | 期刊数据库准备及转换 |
| `journals.js` | 本地生成的期刊数据库（不随仓库分发） |
| `matcher.js` | 期刊识别与匹配 |
| `parser.js` | Google Scholar 论文元数据解析 |
| `background.js` | Crossref API 请求、限流、重试及缓存 |
| `content.js` | 扩展程序核心逻辑与页面集成 |
| `settings.js` | 本地设置管理 |
| `popup.html`, `popup.js`, `popup.css` | 扩展程序设置界面 |
| `filters.js` | 论文筛选 |
| `export.js` | CSV 导出 |
| `profile_loader.js` | 研究者发表记录收集 |
| `profile_cache.js` | 研究者发表记录缓存 |
| `analytics.js` | 论文筛选及统计分析 |
| `analytics_ui.js`, `analytics.css` | 交互式研究者分析面板 |
| `manifest.json` | Chrome 扩展配置 |
| `test.html` | 期刊匹配测试界面 |

Crossref 请求由统一的后台 Service Worker 管理，包括请求排队、限流、自动重试及持久化元数据缓存。

研究者发表记录收集与期刊识别相互独立，以减少网络请求对本地期刊匹配的影响。

## 数据来源

ScholarJournal 整合以下三类信息：

- **Google Scholar：** 论文标题、作者信息、发表年份、引用次数及论文链接。
- **Crossref：** 用于辅助期刊识别的外部文献元数据。
- **用户自行提供的期刊数据库：** 用户独立获取的期刊指标及排名。

有关 Crossref 及其 REST API 的更多信息，请参阅：

- [Crossref](https://www.crossref.org/)
- [Crossref REST API 官方文档](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)

Crossref 仅用于获取文献元数据，不用于获取专有的期刊影响因子或 JCR 排名。

## 隐私说明

ScholarJournal 主要在用户的浏览器本地处理和存储信息。

用户设置、Crossref 元数据缓存以及研究者发表记录缓存均通过 Chrome 扩展程序的本地存储保存。

当本地期刊识别无法确认结果时，论文标题或 DOI 可能会被发送至 Crossref REST API，以获取相应的文献元数据。用户可以在扩展程序设置中关闭 Crossref 元数据查询。

ScholarJournal 无需注册用户账号，不运营专门的数据收集服务器，也不会主动收集 Google 账户登录凭据。

## 数据授权与免责声明

本仓库仅分发 ScholarJournal 的实现代码及数据库准备脚本，不分发专有的 Journal Citation Reports 数据集，也不分发来源于受限访问数据集的期刊指标。

用户必须通过合法且获得授权的渠道独立获取所需的期刊指标，并遵守相关许可协议。

除非用户拥有相应的再分发权利，否则不应重新分发生成的期刊数据库。

## 联系与反馈

ScholarJournal 作为一款科研辅助工具，旨在改善文献探索及论文发表记录分析的工作流程。

如果你在使用过程中遇到问题、有任何建议，或在准备期刊数据库时需要帮助，欢迎通过 GitHub 联系开发者。

- **开发者：** Li Shen
- **GitHub：** [sLee0709](https://github.com/sLee0709)
- **项目仓库：** [ScholarJournal](https://github.com/sLee0709/ScholarJournal)
- **问题报告及功能建议：** [GitHub Issues](https://github.com/sLee0709/ScholarJournal/issues)

欢迎科研社区的反馈与建议。
