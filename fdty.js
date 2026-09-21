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
    var db_url = null;   // 题库独立源（默认与脚本同源，可通过 ?db= 或 localStorage 指定，如国内用户指向 ke.wang）
    var stats = {total: 0, successful: 0};
    var pendingQuestions = [];  // 题库未收录、待 DeepSeek AI 解答的题目

    if (!window.fdty_src) {
        console.error("复旦体育理论考试-自动答题机器已经更新，请至https://github.com/KevinWang15/fdty查看。");
        return;
    } else {
        // 支持从加载地址带参数传入 Key：fdty.js?key=sk-xxx&tavily=tvly-xxx&db=https://ke.wang/fdty/database.js
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
        var _dbParam = window.fdty_src.match(/[?&]db=([^&]+)/);
        if (_dbParam && _dbParam[1]) {
            try { db_url = decodeURIComponent(_dbParam[1]).split('?')[0]; } catch (e) {}
        }
        if (!db_url) {
            try { db_url = localStorage.getItem('fdty_db_url'); } catch (e) {}
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
            // 找不到对应选项时不能直接 .click()——那会抛 TypeError 中断整个循环，
            // 后面的题（包括 AI 兜底）全都不会处理。这里逐个判空并跳过。
            var clickSafe = function (el, msg, color, text) {
                if (!el) {
                    console.warn('未找到对应选项，已跳过（题库与页面题号可能错位），请手动核对：' + text);
                    return;
                }
                el.click();
                console.log(msg, color, 'color: black');
            };
            if (answer === true) {
                questionI.trueOrFalse++;
                clickSafe(getRadioButtonElement(questionI.trueOrFalse, answer),
                    (questionI.trueOrFalse + 1) + "." + '%c√正确 %c' + question.text, 'color: green', question.text);
            } else if (answer === false) {
                questionI.trueOrFalse++;
                clickSafe(getRadioButtonElement(questionI.trueOrFalse, answer),
                    (questionI.trueOrFalse + 1) + "." + '%c×错误 %c' + question.text, 'color: red', question.text);
            } else {
                questionI.choice++;
                clickSafe(getRadioButtonElementForMultipleSelection(questionI.choice, answer),
                    (questionI.choice + 1) + "." + '%c答案：' + answer + ' %c' + question.text, 'color: orange', question.text);
            }
        });

        stats.total += questions.length;
        stats.successful += successCount;
    }


    //以下为加载器。callback 可选传 onerror：加载失败时调用（用于题库等关键资源回退）
    function loadScript(url, callback, onerror) {
        var script = document.createElement("script");
        script.type = "text/javascript";
        var done = false;
        var timeout = setTimeout(function () {
            if (!done) { done = true; if (onerror) onerror(); }
        }, 15000);   // 15 秒超时，避免坏 URL 永久卡住

        function ok() {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            if (callback) callback();
        }
        function fail() {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            if (onerror) onerror();
        }

        if (script.readyState) {
            script.onreadystatechange = function () {
                if (script.readyState == "loaded" || script.readyState == "complete") {
                    script.onreadystatechange = null;
                    ok();
                }
            };
        } else {
            script.onload = ok;
            script.onerror = fail;
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
    // 完全可选：不带 Key 运行就与原版一致，不触发 AI、不打扰；带 Key 才启用。
    // 启用方式（任选其一）：
    //   1) 把 Key 拼进加载地址：fdty.js?key=sk-xxx（推荐，自动保存，下次无需再带）
    //   2) 控制台执行 localStorage.setItem('fdty_deepseek_key', 'sk-xxx')
    // Key 仅保存在本机浏览器 localStorage，不会上传到任何地方。
    // 可选配置（控制台执行一次）：
    //   localStorage.setItem('fdty_deepseek_model', 'deepseek-flash') 指定模型（默认自动探测：取 /models 实时清单里最便宜、最快的那个）
    //   localStorage.setItem('fdty_tavily_key', 'tvly-xxx')           配置 Tavily 联网搜索（https://tavily.com 免费）

    var DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
    var DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/models';

    // 读取本地配置的 Key。AI 答题是可选功能：没配 Key 就完全不用，不打扰用户。
    function getStoredKey(name) {
        try {
            var v = localStorage.getItem(name);
            if (v) return v;
        } catch (e) {}
        return null;
    }

    // 探测可用的 DeepSeek 模型。
    // 注意：DeepSeek 的模型名换得很勤（deepseek-chat/reasoner → deepseek-v4-flash/v4-pro → …），
    // 写死"某个名字一定可用"迟早会失效（旧名一停用，AI 就永久静默失败）。
    // 所以这里不写死具体型号，而是每次从 /models 拿**实时清单**，按"便宜、快"的规则挑一个。
    var MODEL_EXCLUDE = /embed|rerank|tts|whisper|audio|moderation|image|vision|ocr/i;  // 非对话模型
    var MODEL_CHEAP = /flash|lite|mini|turbo|fast|small|chat/i;   // 便宜、快
    var MODEL_HEAVY = /pro|max|ultra|reasoner|thinking|large/i;   // 贵、慢

    // 打分：优先便宜/快的（±20 是大方向），版本号只作为同档次的次要偏好
    function scoreModel(id) {
        var s = 0;
        if (MODEL_CHEAP.test(id)) s += 20;
        if (MODEL_HEAVY.test(id)) s -= 20;
        var v = id.match(/(\d+)/);
        if (v) s += parseInt(v[1], 10);
        return s;
    }

    function pickModel(ids) {
        var candidates = ids.filter(function (id) { return id && !MODEL_EXCLUDE.test(id); });
        if (!candidates.length) candidates = ids.slice();
        if (!candidates.length) return null;
        candidates.sort(function (a, b) { return scoreModel(b) - scoreModel(a); });
        return candidates[0];
    }

    function clearModelCache() {
        try {
            localStorage.removeItem('fdty_detected_model');
            localStorage.removeItem('fdty_detected_model_key');
            localStorage.removeItem('fdty_detected_model_time');
        } catch (e) {}
    }

    var MODEL_CACHE_TTL = 24 * 60 * 60 * 1000;   // 模型清单会变，缓存最多用 24 小时

    // forceRefresh=true：忽略缓存重新探测（模型调用报 not found 时用）
    function detectDeepSeekModel(apiKey, callback, forceRefresh) {
        try {
            var configured = localStorage.getItem('fdty_deepseek_model');
            if (configured) { callback(configured); return; }
        } catch (e) {}
        // 缓存同时绑定 key 与时间：换 key、或缓存过期，都会重新探测
        if (!forceRefresh) {
            try {
                if (localStorage.getItem('fdty_detected_model_key') === apiKey) {
                    var cached = localStorage.getItem('fdty_detected_model');
                    var ts = parseInt(localStorage.getItem('fdty_detected_model_time') || '0', 10);
                    if (cached && (+new Date() - ts) < MODEL_CACHE_TTL) { callback(cached); return; }
                }
            } catch (e) {}
        }
        fetch(DEEPSEEK_MODELS_URL, {
            headers: { 'Authorization': 'Bearer ' + apiKey }
        }).then(function (res) { return res.json(); }).then(function (data) {
            var ids = ((data && data.data) || []).map(function (m) { return m && m.id; }).filter(function (x) { return !!x; });
            var chosen = pickModel(ids);
            if (!chosen) throw new Error('模型列表为空');
            try {
                localStorage.setItem('fdty_detected_model', chosen);
                localStorage.setItem('fdty_detected_model_key', apiKey);
                localStorage.setItem('fdty_detected_model_time', String(+new Date()));
            } catch (e) {}
            callback(chosen);
        }).catch(function () {
            // 探测失败（网络抖动等）：同 key 的旧缓存即使过期也先拿来用——总比没有强。
            // 若这个模型其实已下架，调用时会报错，届时再清缓存重探（见 askDeepSeek）。
            try {
                var c = localStorage.getItem('fdty_detected_model');
                if (c && localStorage.getItem('fdty_detected_model_key') === apiKey) { callback(c); return; }
            } catch (e) {}
            callback(null);   // 拿不到就不猜名字——猜错只会更难排查
        });
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
    // 匹配“序号.答案”，容忍答案后附加的标点/收尾词（如 “A。” “对 ” “D 完成”），
    // 也兼容挤在一行、带前缀等情况。
    function parseDeepSeekAnswers(content, questionCount) {
        var results = [];
        var text = String(content || '');
        // 先把“序号.答案”拆成行（在数字+分隔符前插换行），兼容挤在一行的情况
        var re = /(\d+)\s*[.、:：)\]](?=\s*[正确错误对错ABCD])/g;
        text = text.replace(re, '\n$&');
        var lines = text.split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            // 必须以“序号+分隔符”开头（排除纯解释文字），然后提取答案 token
            var m = line.match(/^(\d+)\s*[.、:：)\]](.*)$/i);
            if (!m) continue;
            var idx = parseInt(m[1], 10);
            if (idx < 1 || idx > questionCount) continue;
            var rest = m[2].trim();
            // 容忍 “1.选A”“1.应选B” 这类写法：剥掉开头的引导词（仅当后面紧跟答案时才剥，"选"本身不是答案）
            rest = rest.replace(/^(?:应该选|应选|选)\s*(?=[正确错误对错ABCD])/i, '');
            // 在剩余内容里找第一个答案 token：对/错/正确/错误/A-D（A-D 要求是独立字母，
            // 后面不能跟大写字母，避免匹配到 Computer/Answer 等英文单词里的字母）
            var am = rest.match(/(正确|错误|对|错|([ABCD])(?![A-Z]))/i);
            if (!am) continue;
            // 排除常见干扰：
            // 1) 答案 token 前紧跟解释性文字（中英文）→ 可能是解释而非答案
            var before = rest.slice(0, am.index);
            if (/正确|错误|答案|是|选|项|为|\b(?:correct|answer|is|choose|option)\b/i.test(before)) continue;
            // 2) 若答案是“对/错/正确/错误”这类判断题答案，但后面还跟着选项字母（如“正确答案是A”“选B”），
            //    说明它在解释而非作答，跳过避免误判。
            if (/^(正确|错误|对|错)$/i.test(am[1])) {
                var after = rest.slice(am.index + am[1].length);
                if (/[ABCD]/i.test(after)) continue;
            }
            var raw = am[1].toUpperCase();
            var answer;
            if (raw === '对' || raw === '正确') answer = true;
            else if (raw === '错' || raw === '错误') answer = false;
            else if ('ABCD'.indexOf(raw) >= 0) answer = raw;
            else continue;
            results.push({ index: idx - 1, answer: answer });
        }
        return results;
    }

    // 发送一次对话请求。HTTP 错误也把 API 的 message 带出来，便于判断该走哪种自愈重试。
    function postChat(apiKey, payload, onSuccess, onError) {
        fetch(DEEPSEEK_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify(payload)
        }).then(function (r) {
            if (r.ok) return r.json();
            return r.json().catch(function () { return {}; }).then(function (body) {
                var msg = (body && body.error && body.error.message) || ('HTTP ' + r.status);
                var err = new Error(r.status === 401 ? 'API Key 无效或已过期' : msg);
                err.status = r.status;
                throw err;
            });
        }).then(function (data) {
            onSuccess((data && data.choices && data.choices[0]) || {});
        }).catch(onError);
    }

    function askDeepSeek(questions, callback) {
        var apiKey = getStoredKey('fdty_deepseek_key');
        if (!apiKey) { callback([]); return; }   // 未配置 Key：完全静默跳过，AI 答题为可选功能

        var lines = questions.map(function (q, i) {
            return (i + 1) + '.[' + (q.type === 'trueOrFalse' ? '判断题' : '单选题') + ']' + q.text;
        });
        var basePrompt = '你是复旦体育理论考试答题助手。请根据体育知识回答以下题目。\n' +
            '输出要求：每题一行，格式为“序号.答案”。判断题答案只写“对”或“错”；单选题答案只写选项字母 A/B/C/D。\n' +
            '禁止输出任何解释或思考过程。\n';

        var triedModelRetry = false, triedRelax = false, triedStripParams = false;

        var run = function (model, refText) {
            var promptText = basePrompt +
                (refText ? '\n参考资料（来自网络搜索，可能包含答案线索，仅供参考）：\n' + refText + '\n' : '') +
                '\n题目：\n' + lines.join('\n');

            var payload = {
                model: model,
                messages: [
                    { role: 'system', content: '你是复旦体育理论考试答题助手，只输出简洁答案，不解释。' },
                    { role: 'user', content: promptText }
                ],
                max_tokens: triedRelax ? 8000 : 3000
            };
            if (!triedStripParams) {
                payload.temperature = 0.1;
                // 关键：显式关闭思考模式。本任务是"题干 → 答案"的简单抽取，不需要思维链。
                // 实测 deepseek-flash 默认就开思考：40 题时 3000 max_tokens 会被思考全部吃光、
                // content 为空 → 答案全军覆没；关掉后同样 40 题只花 159 tokens 且全部答对。
                payload.thinking = { type: 'disabled' };
            }

            postChat(apiKey, payload, function (choice) {
                var content = choice.message && choice.message.content;
                if (!content && choice.finish_reason === 'length' && !triedRelax) {
                    // 空内容 + 被截断：多半是模型忽略了 thinking:disabled、思考把预算吃光了。
                    // 加大预算重试一次（只有真踩到这个坑时才多花一次钱）。
                    triedRelax = true;
                    console.warn('DeepSeek 返回为空（思考可能占满了 token 预算），正在加大预算重试一次…');
                    run(model, refText);
                    return;
                }
                if (!content) { callback([]); return; }
                var answers = parseDeepSeekAnswers(content, questions.length);
                console.log('%cDeepSeek 返回：' + JSON.stringify(answers), 'color: #6A5ACD');
                callback(answers);
            }, function (err) {
                var m = String((err && err.message) || '');
                // 模型名失效（下架/改名）：清掉缓存重新探测，用新模型重试一次
                if (!triedModelRetry && err.status === 400 && /model/i.test(m)) {
                    triedModelRetry = true;
                    // 手动指定的模型名（fdty_deepseek_model）也可能已下架：一并清掉，
                    // 否则重新探测会直接命中这个覆盖值、又拿回同一个坏名字。
                    try { localStorage.removeItem('fdty_deepseek_model'); } catch (e) {}
                    console.warn('当前模型不可用（' + m + '），正在重新探测模型…');
                    clearModelCache();
                    detectDeepSeekModel(apiKey, function (newModel) {
                        if (!newModel) { console.error('DeepSeek 调用失败：无法获取可用模型'); callback([]); return; }
                        console.info('已切换到模型：' + newModel);
                        run(newModel, refText);
                    }, true);
                    return;
                }
                // 参数不被该模型支持（如不接受 thinking / temperature）：去掉可选参数重试一次
                if (!triedStripParams && err.status === 400 && /param|argument|unsupported|unknown/i.test(m)) {
                    triedStripParams = true;
                    console.warn('模型不接受可选参数（' + m + '），正在去掉可选参数重试…');
                    run(model, refText);
                    return;
                }
                console.error('DeepSeek 调用失败：' + m);
                callback([]);
            });
        };

        detectDeepSeekModel(apiKey, function (model) {
            if (!model) {
                console.error('DeepSeek 调用失败：未能获取可用模型列表（请检查网络后重试）。');
                callback([]);
                return;
            }
            console.info('使用模型：' + model);
            // 若配置了 Tavily，先并发搜索（最多 5 题，避免过慢）
            var tavilyKey = null;
            try { tavilyKey = localStorage.getItem('fdty_tavily_key'); } catch (e) {}
            if (tavilyKey && questions.length <= 5) {
                var promises = questions.map(function (q) {
                    return new Promise(function (resolve) { searchWeb(q.text, resolve); });
                });
                Promise.all(promises).then(function (refs) {
                    run(model, refs.filter(function (x) { return x; }).join('\n\n'));
                });
            } else {
                run(model, '');
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
            // 按题型校验答案类型，防止 AI 类型错配（如把判断题答成字母、单选答成对/错）导致异常
            if (q.type === 'trueOrFalse') {
                if (a.answer !== true && a.answer !== false) return;
                el = getRadioButtonElement(q.index, a.answer);
            } else {
                if (typeof a.answer !== 'string' || !/^[ABCD]$/i.test(a.answer)) return;
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
        // 未配置 Key：完全静默返回，不打印任何 AI 相关日志（与原始脚本行为一致，不打扰）
        if (!getStoredKey('fdty_deepseek_key')) return;
        console.info('题库未收录 ' + questions.length + ' 题，正在调用 DeepSeek AI 解答…');
        askDeepSeek(questions, function (answers) {
            if (!answers.length) {
                console.warn('DeepSeek 未能给出答案（调用失败），请手动作答这几题。');
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

                    // 组装题库 URL：db_url 已带 query 则用 & 追加时间戳，否则用 ?
                    var dbUrl = db_url || (base_url + 'database.js');
                    dbUrl += (dbUrl.indexOf('?') >= 0 ? '&' : '?') + (+new Date());
                    // 题库加载失败（网络错误，或"加载成功"但没产出 fdty_database——比如 CDN 返回了 HTML 错误页）。
                    // 若是自定义源导致的，清掉它并回退到同源题库重试一次。
                    var onDbFail = function () {
                        if (db_url) {
                            console.error('自定义题库源加载失败，已回退到默认题库源：' + db_url);
                            try { localStorage.removeItem('fdty_db_url'); } catch (e) {}
                            db_url = null;
                            loadDb(base_url + 'database.js?' + (+new Date()));
                        } else {
                            console.error('题库下载失败，请检查网络后刷新页面重试。');
                        }
                    };

                    var loadDb = function (url) {
                        loadScript(url, function () {
                            // 必须校验题库真的存在：脚本"加载成功"不等于内容正确，
                            // 否则下面 Object.keys 会直接抛错、整个流程无声中断。
                            if (!window.fdty_database || typeof window.fdty_database !== 'object') {
                                onDbFail();
                                return;
                            }
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
                        }, onDbFail);
                    };
                    loadDb(dbUrl);
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
