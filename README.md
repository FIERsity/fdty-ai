# 复旦体育理论考试-自动答题机器（AI 版） ![收录题目总数](https://img.shields.io/badge/收录题目总数-6501-green.svg) ![最后更新时间](https://img.shields.io/badge/最后更新时间-2026/08/06-blue.svg)

## 项目说明
本项目是 [KevinWang15/fdty](https://github.com/KevinWang15/fdty) 的 **AI 增强版**：在原版“题库精确匹配、自动勾选”的基础上，增加了 **DeepSeek AI 智能兜底**——题库里没有的新题，也会自动调用 AI 作答并勾选，进一步减少漏题。

* 基于开源项目 [KevinWang15/fdty](https://github.com/KevinWang15/fdty)，感谢原作者多年的维护与贡献！
* 题库精确匹配（6501 题）+ DeepSeek AI 兜底，双重保障。
* AI 可选：配置 DeepSeek API Key 后启用；未配置时使用题库。
* 方便易用，基于Chrome，兼容所有操作系统，无需安装任何软件。
* 自动读取网页、匹配题库，瞬间出答案、自动勾选，节省时间。
* 支持是非题与单选题。
* 题干有改动时，启用 AI 会参考相似题和当前选项作答；只用题库时仍会请你确认相似题。

> 本项目仅限技术交流，完全开源，无任何盈利行为。也请同学们重视体育理论考试，好好准备体育理论考试。

## 一张图体会一下
![show](screenshots/show.png?2017-5-22)
不光自动匹配，还会帮您自动勾选上！

## 使用方法

### 1. 使用 **Chrome** 打开考试界面
以下步骤适用于能在开发者工具中看到 `paper (stexampaperV1.aspx)` 的旧版试题页。已在仓库的两张样卷上验证；[本学期通知](https://fdty.fudan.edu.cn/38/6f/c29222a800879/page.htm)所列的超星页面尚未验证。

### 2. 在考试界面中，打开开发者工具里的控制台
确保考试界面是激活状态的（不是灰的），然后在该界面按：

| 操作系统    | 快捷键                                      |
| ------- | ---------------------------------------- |
| Windows | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd> |
| Mac     | <kbd>Command</kbd>+<kbd>Option</kbd>+<kbd>J</kbd> |

### 3. 修改左上角下拉菜单的值
![show](screenshots/1.png?2017-5-22)

调整为 ```paper(stexampaperV1.aspx)```

### 4. 复制以下代码，粘贴、运行
![show](screenshots/2.png?2017-5-22)

	var fdty_src="https://cdn.jsdelivr.net/gh/FIERsity/fdty-ai@master/fdty.js?db=https://ke.wang/fdty/database.js";var f_sl = document.createElement("script");f_sl.type = "text/javascript";console.info('正在加载自动答题脚本');f_sl.src = fdty_src + (fdty_src.indexOf('?') >= 0 ? '&' : '?') + (+new Date());document.getElementsByTagName("head")[0].appendChild(f_sl);

首次启用 AI 可直接使用下方「AI 自动答题」中的代码。

### 5. 检查试卷、补充未填写的题目、交卷
![show](screenshots/3.png?2017-5-22)
等题目上方显示“程序完成”后，检查待处理题号。可以展开 AI 填写清单，点击题目核对选项，再手动交卷。脚本会保留你已选的答案，包括等待 AI 时手动选择的答案。

# PR请求

## 求完善题库（长期）

虽然题库已经比较全了，但体育部仍然会偶尔新加一些题、改一些题的。

如果您手上有新的题库，请[点击这个链接](https://github.com/KevinWang15/fdty/issues/3)分享给原作者。

（注意：分享单选题答案的时候，重要的是答案选项哦（A B C D），这是程序做自动勾选的依据，分享时一定要带上）

您也可以发Pull Request，

### 题库生成方法：

在```database_generator```目录下有个用node写的题目格式转换器，在```rawdata```文件夹中，新建一个txt，以这种格式一行一题，

	["获得和利用食物的综合过程称为营养。","true"],
	["合理的营养意味着机体能够摄入保持身体健康所必须的部分营养成分。","false"],
	...

（原始题库、转换题库成以上格式时用到的正则表达式也请记录一下哦）

然后运行```node generate.js```就行了，谢谢。

# AI 自动答题（可选，DeepSeek）

题库里没有的题，可以让 AI 帮您答。

首次运行时，在提示框输入自己的 [DeepSeek API Key](https://platform.deepseek.com)。取消后继续使用题库。新配置保存在当前标签页的会话存储中，已有的本地配置也可使用。

```js
(() => {
    if (!sessionStorage.getItem('fdty_deepseek_key') && !localStorage.getItem('fdty_deepseek_key')) {
        const key = prompt('DeepSeek API Key（取消则只使用题库）');
        if (key?.trim()) sessionStorage.setItem('fdty_deepseek_key', key.trim());
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/gh/FIERsity/fdty-ai@master/fdty.js?db=https://ke.wang/fdty/database.js';
    document.head.append(script);
})();
```

Key 仅用于向对应 API 鉴权。用过旧版 `?key=` 加载方式的用户，建议更换该 Key，因为脚本请求会将 URL 参数一并发送给 CDN。

（可选）想指定模型、开联网搜索，在控制台执行一次：

	localStorage.setItem('fdty_deepseek_model', 'deepseek-flash')
	localStorage.setItem('fdty_tavily_key', 'tvly-你的key')

不指定的话，脚本会自动读取您账号的可用模型，优先选择 Flash 等轻量模型。

启用 AI 时，待答题的题干、当前选项和相似题参考会发给 DeepSeek；另外配置 Tavily 后，待答题不超过 5 题时也会向 Tavily 搜索题干。

## 备用加载方案（gh-proxy）

如果上面的地址加载失败（比如 jsDelivr 暂时连不上），可以用 GitHub 反向代理 `gh-proxy.com` 作为备用源，仅用于加载脚本与题库：

	var fdty_src="https://gh-proxy.com/https://raw.githubusercontent.com/FIERsity/fdty-ai/master/fdty.js?db=https://ke.wang/fdty/database.js";var f_sl = document.createElement("script");f_sl.type = "text/javascript";console.info('正在加载自动答题脚本');f_sl.src = fdty_src + (fdty_src.indexOf('?') >= 0 ? '&' : '?') + (+new Date());document.getElementsByTagName("head")[0].appendChild(f_sl);

此代理为第三方脚本来源，请使用你信任的服务。Key 的配置方式与主方案相同，请勿将 Key 拼入加载地址。
