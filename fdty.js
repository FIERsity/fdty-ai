/**
 * =======================================
 * 复旦体育考试-自动答题机器
 * =======================================
 * 方便易用，基于Chrome，兼容所有操作系统。
 * 自动读取网页、匹配题库，瞬间出答案、自动勾选，节省时间。
 *
 * https://github.com/KevinWang15/fdty
 *
 * 求完善题库，请发Pull Request
 *
 * By 王轲 (KevinWang)
 * 2018-12-3
 */

(function () {

    var base_url;
    var stats = {total: 0, successful: 0};
    var pendingQuestions = [];  // 题库未收录、待 DeepSeek AI 解答的题目

    if (!window.fdty_src) {
        console.error("复旦体育理论考试-自动答题机器已经更新，请至https://github.com/KevinWang15/fdty查看。");
        return;
    } else {
        // 支持从加载地址带参数传入 Key：fdty.js?key=sk-xxx&tavily=tvly-xxx
        // 用户把 Key 拼进加载代码即可，脚本自动保存到 localStorage，下次无需再配。
        var _keyParam = window.fdty_src.match(/[?&]key=([^&]+)/);
        if (_keyParam && _keyParam[1]) {
            try {
                localStorage.setItem('fdty_deepseek_key', decodeURIComponent(_keyParam[1]));
                console.info('已从加载地址读取并保存 DeepSeek API Key，下次运行无需再配置。');
            } catch (e) {}
        }
        var _tavilyParam = window.fdty_src.match(/[?&]tavily=([^&]+)/);
        if (_tavilyParam && _tavilyParam[1]) {
            try {
                localStorage.setItem('fdty_tavily_key', decodeURIComponent(_tavilyParam[1]));
            } catch (e) {}
        }
        base_url = window.fdty_src.split('?')[0].replace(/fdty.js$/, '')
    }

    function stripUnimportantChars(str) {
        return str.replace(/[ 　\t\r\n,，\.。:：“”《》？?！!~～｀`【】()_—\-＿－（）<>、\/\\"'`]/mg, "").toLowerCase();
    }

    function getRadioButtonElement(id, answer) {
        return $('input', $('#repVer_rbtn_ver_' + id)).filter(function (_, item) {
            return (+item.value == +answer);
        })[0];
    }

    function getRadioButtonElementForMultipleSelection(id, answer) {
        answer = stripUnimportantChars(answer);
        return $('input', $('#repSin_RadioButtonList1_' + id)).filter(function (_, item) {
            return (item.value.trim().toUpperCase() == answer.trim().toUpperCase());
        })[0];
    }

    function doWork(panelElement) {
        //主要算法在此。

        var html = panelElement.html();
        var questions = [];

        var successCount = 0;
        var questionI = { trueOrFalse: -1, choice: -1 };

        var regexp = /(\d+)\s*\n\s*\.\s*\n\s*(.+?)$[\s\S]+?table id="(.+?)"/mg;
        var match = regexp.exec(html);
        while (match != null) {
            var type = match[3].indexOf('Radio')>=0?'choice':'trueOrFalse';
            var optionsText = '';
            if (type === 'choice') {   // 单选题：抓取选项文本，便于 AI 作答
                optionsText = panelElement.find('#' + match[3]).find('label').map(function (_, l) { return $(l).text().trim(); }).get().join(' ');
            }
            questions.push({id: +match[1], text: match[2], type: type, options: optionsText});
            match = regexp.exec(html);
        }
        questions.forEach(function (question) {
            var strippedText = stripUnimportantChars(question.text);
            var answer = window.fdty_database[strippedText];

            if (typeof answer == 'undefined') {
                answer = tryFindSimilar(question.text);
                if (typeof answer == 'undefined') {
                    questionI[question.type]++;
                    pendingQuestions.push({type: question.type, index: questionI[question.type], text: question.text + (question.options ? '\n选项：' + question.options : '')});
                    if(question.type==='trueOrFalse'){
                        console.log((questionI[question.type]+1) + '.%c?失配 %c'+ question.text,'color: #B700FF','color:black');
                    }else {
                        console.log((questionI[question.type]+1) + '.%c答案：? %c'+ question.text,'color: #B700FF','color:black');
                    }
                    return;
                }
            }

            successCount++;
            if (answer === true) {
                questionI.trueOrFalse++;
                getRadioButtonElement(questionI.trueOrFalse, answer).click();
                console.log((questionI.trueOrFalse + 1) + "." + '%c√正确 %c' + question.text, 'color: green', 'color: black');
            } else if (answer === false) {
                questionI.trueOrFalse++;
                getRadioButtonElement(questionI.trueOrFalse, answer).click();
                console.log((questionI.trueOrFalse + 1) + "." + '%c×错误 %c' + question.text, 'color: red', 'color: black');
            } else {
                questionI.choice++;
                getRadioButtonElementForMultipleSelection(questionI.choice, answer).click();
                console.log((questionI.choice + 1) + "." + '%c答案：' + answer + ' %c' + question.text, 'color: orange', 'color: black');
            }
        });

        stats.total += questions.length;
        stats.successful += successCount;
    }


    //以下为加载器
    function loadScript(url, callback) {
        var script = document.createElement("script");
        script.type = "text/javascript";

        if (script.readyState) {
            script.onreadystatechange = function () {
                if (script.readyState == "loaded" || script.readyState == "complete") {
                    script.onreadystatechange = null;
                    callback();
                }
            };
        } else {
            script.onload = function () {
                callback();
            };
        }

        script.src = url;
        document.getElementsByTagName("head")[0].appendChild(script);
    }

    function tryFindSimilar(text) {
        // 若都选择否，则返回undefined
        var text_core_strip_parentheses = stripUnimportantChars(text.replace(/(\(.+?\)|（(.+?)）|【(.+?)】|\[(.+?)\])/mg, ""));
        var text_core = stripUnimportantChars(text);
        var threshold = text_core.length * 0.22;
        for (var key in window.fdty_database) {
            if (!window.fdty_database.hasOwnProperty(key))
                continue;

            var possible = false;

            //尝试Levenshtein
            var LevenshteinDistance = new Levenshtein(text_core, key).distance;
            if (LevenshteinDistance <= threshold)
                possible = true;

            //尝试包含
            if (key.indexOf(text_core_strip_parentheses) >= 0)
                possible = true;

            if (possible) {
                if (confirm(text + '\n' + key + '\n这两题是否一样？')) {
                    return window.fdty_database[key];
                }
            }
        }
        return undefined;
    }


    // ==================== DeepSeek AI 自动答题（可选功能） ====================
    // 启用方式：首次运行时在弹窗输入 DeepSeek API Key（https://platform.deepseek.com 获取），
    // 或提前在控制台执行 localStorage.setItem('fdty_deepseek_key', 'sk-xxx')。
    // Key 仅保存在本机浏览器 localStorage，不会上传到任何地方。
    // 可选配置：
    //   localStorage.setItem('fdty_deepseek_model', 'deepseek-chat')  指定模型（默认自动探测，优先 deepseek-v4-flash）
    //   localStorage.setItem('fdty_deepseek_effort', 'low')           思考强度 low/medium/high（默认 low，high 会过度思考导致超时）
    //   localStorage.setItem('fdty_tavily_key', 'tvly-xxx')           配置 Tavily 联网搜索（https://tavily.com 免费）

    var DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
    var DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/models';

    function getStoredKey(name, tip) {
        try {
            var v = localStorage.getItem(name);
            if (v) return v;
        } catch (e) {}
        var input = window.prompt(tip);
        if (input && input.trim()) {
            try { localStorage.setItem(name, input.trim()); } catch (e) {}
            return input.trim();
        }
        return null;
    }

    // 探测可用的 DeepSeek 模型（兼容 deepseek-chat / deepseek-v4-pro / deepseek-v4-flash / deepseek-reasoner）
    function detectDeepSeekModel(apiKey, callback) {
        try {
            var configured = localStorage.getItem('fdty_deepseek_model');
            if (configured) { callback(configured); return; }
        } catch (e) {}
        fetch(DEEPSEEK_MODELS_URL, {
            headers: { 'Authorization': 'Bearer ' + apiKey }
        }).then(function (res) { return res.json(); }).then(function (data) {
            var ids = ((data && data.data) || []).map(function (m) { return m.id; });
            var priority = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-v4-pro', 'deepseek-reasoner'];
            for (var i = 0; i < priority.length; i++) {
                if (ids.indexOf(priority[i]) >= 0) { callback(priority[i]); return; }
            }
            callback(ids[0] || 'deepseek-chat');
        }).catch(function () { callback('deepseek-chat'); });
    }

    // 可选：联网搜索（Tavily），把结果作为参考资料喂给 AI
    function searchWeb(query, callback) {
        var tavilyKey = null;
        try { tavilyKey = localStorage.getItem('fdty_tavily_key'); } catch (e) {}
        if (!tavilyKey) { callback(''); return; }
        fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: tavilyKey, query: query, max_results: 3, search_depth: 'basic' })
        }).then(function (r) { return r.json(); }).then(function (d) {
            var refs = (d.results || []).map(function (x) { return (x.title || '') + ': ' + (x.content || ''); });
            callback(refs.join('\n'));
        }).catch(function () { callback(''); });
    }

    // 解析 AI 返回的答案文本 -> [{index, answer}]（index 为 0-based 题目序号）
    function parseDeepSeekAnswers(content, questionCount) {
        var results = [];
        var lines = String(content || '').split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
            var m = lines[i].trim().match(/^\s*(\d+)\s*[.、:：)\]][\s\S]*?(正确|错误|对|错|[ABCD])\s*$/i);
            if (!m) continue;
            var idx = parseInt(m[1], 10);
            if (idx < 1 || idx > questionCount) continue;
            var raw = m[2].toUpperCase();
            var answer;
            if (raw === '对' || raw === '正确') answer = true;
            else if (raw === '错' || raw === '错误') answer = false;
            else if ('ABCD'.indexOf(raw) >= 0) answer = raw;
            else continue;
            results.push({ index: idx - 1, answer: answer });
        }
        return results;
    }

    function askDeepSeek(questions, callback) {
        var apiKey = getStoredKey('fdty_deepseek_key', '请输入 DeepSeek API Key（https://platform.deepseek.com 获取，仅保存在本机浏览器，不会上传）：\n若不想使用 AI 答题，直接点取消即可。');
        if (!apiKey) { console.warn('未配置 DeepSeek API Key，跳过 AI 答题。'); callback([]); return; }

        detectDeepSeekModel(apiKey, function (model) {
            var lines = questions.map(function (q, i) {
                return (i + 1) + '.[' + (q.type === 'trueOrFalse' ? '判断题' : '单选题') + ']' + q.text;
            });

            var afterSearch = function (refText) {
                var effort = 'low';
                try { effort = localStorage.getItem('fdty_deepseek_effort') || 'low'; } catch (e) {}
                var promptText = '你是复旦体育理论考试答题助手。请根据体育知识回答以下题目。\n' +
                    '输出要求：每题一行，格式为“序号.答案”。判断题答案只写“对”或“错”；单选题答案只写选项字母 A/B/C/D。\n' +
                    '禁止输出任何解释或思考过程。\n' +
                    (refText ? '\n参考资料（来自网络搜索，可能包含答案线索，仅供参考）：\n' + refText + '\n' : '') +
                    '\n题目：\n' + lines.join('\n');

                fetch(DEEPSEEK_API, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + apiKey
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [
                            { role: 'system', content: '你是复旦体育理论考试答题助手，只输出简洁答案，不解释。' },
                            { role: 'user', content: promptText }
                        ],
                        temperature: 0.1,
                        max_tokens: 3000,
                        reasoning_effort: effort
                    })
                }).then(function (r) {
                    if (!r.ok) throw new Error('DeepSeek HTTP ' + r.status);
                    return r.json();
                }).then(function (data) {
                    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                    var answers = parseDeepSeekAnswers(content, questions.length);
                    console.log('%cDeepSeek 返回：' + JSON.stringify(answers), 'color: #6A5ACD');
                    callback(answers);
                }).catch(function (err) {
                    console.error('DeepSeek 调用失败：' + err.message);
                    callback([]);
                });
            };

            // 若配置了 Tavily，先并发搜索（最多 5 题，避免过慢）
            var tavilyKey = null;
            try { tavilyKey = localStorage.getItem('fdty_tavily_key'); } catch (e) {}
            if (tavilyKey && questions.length <= 5) {
                var promises = questions.map(function (q) {
                    return new Promise(function (resolve) { searchWeb(q.text, resolve); });
                });
                Promise.all(promises).then(function (refs) {
                    afterSearch(refs.filter(function (x) { return x; }).join('\n\n'));
                });
            } else {
                afterSearch('');
            }
        });
    }

    // 把 AI 答案填到页面上
    function applyDeepSeekAnswers(answers, questions) {
        var applied = 0;
        answers.forEach(function (a) {
            var q = questions[a.index];
            if (!q) return;
            var el = null;
            if (q.type === 'trueOrFalse') {
                el = getRadioButtonElement(q.index, a.answer);
            } else {
                el = getRadioButtonElementForMultipleSelection(q.index, a.answer);
            }
            if (el) {
                el.click();
                applied++;
                console.log('%cAI自动作答：' + (q.type === 'trueOrFalse' ? (a.answer === true ? '√' : '×') : a.answer) + ' %c' + q.text.split('\n')[0], 'color: #6A5ACD', 'color: black');
            }
        });
        return applied;
    }

    function solveWithDeepSeek(questions) {
        if (!questions.length) return;
        console.info('题库未收录 ' + questions.length + ' 题，正在调用 DeepSeek AI 解答…');
        askDeepSeek(questions, function (answers) {
            if (!answers.length) {
                console.warn('DeepSeek 未能给出答案（未配置 Key 或调用失败），请手动作答这几题。');
                return;
            }
            var applied = applyDeepSeekAnswers(answers, questions);
            console.info('DeepSeek AI 已自动作答 ' + applied + '/' + questions.length + ' 题，请核对！');
        });
    }


    loadScript(base_url + "lib/jquery.min.js", function () {
        loadScript(base_url + "lib/levenshtein.js", function () {
            var IntervalId = 0;
            console.info('请在考试界面中运行本程序哦！\n点击“开始考试”，能看到题目，计时器开始走，然后将Chrome开发者工具的“top”下拉菜单调整到paper(stexampaperV1.aspx)后。');
            console.info('正在寻找页面中的题目…');
            IntervalId = setInterval(function () {
                var panelElement = window.jQuery('#Panel3');
                if (!!panelElement && !!panelElement.html()) {
                    clearInterval(IntervalId);
                    IntervalId = -9999;
                    console.info('成功找到题目！');
                    console.info('正在下载题库，请稍后（比较大，要下载一会儿）');

                    loadScript(base_url + 'database.js?' + (+new Date()), function () {
                        console.info('题库下载成功！总共' + Object.keys(window.fdty_database).length + "条记录");

                        for (var i = 3; i > 0; i--) {
                            var panel = window.jQuery('#Panel' + i);
                            if (panel.length)
                                doWork(panel);
                        }

                        console.info('总共' + stats.total + "题，匹配成功" + stats.successful + "题。\n　");

                        if (pendingQuestions.length > 0) {
                            solveWithDeepSeek(pendingQuestions);
                        }

                        console.warn('程序完成，请【仔细核对】！\n请过几分钟，等计时器走到一个正常数字了，再交卷！');
                        console.log('%c反馈问题: https://github.com/KevinWang15/fdty/issues', 'color: #AAA;');
                    });
                }
            }, 100);

            setTimeout(function () {
                if (IntervalId != -9999) {
                    console.warn('仍然没有找到题目，您确定已经点了开始考试、在考试界面中，而且Chrome开发者工具的“top”下拉菜单调整到了paper(stexampaperV1.aspx)中了？\n如果您是忘记调整到paper(stexampaperV1.aspx)中了，请调整后重新运行代码（无需刷新页面）。');
                }
            }, 3000);
        });
    });
})();
