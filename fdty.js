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

(async function () {
    'use strict';

    if (window.fdtyRunning) {
        console.info('正在处理这张试卷，请稍候。');
        return;
    }
    const source = new URL(document.currentScript?.src || window.fdty_src, location.href);
    const bundledBank = new URL('database.js', source).href;
    const customBank = source.searchParams.get('db') || getStoredKey('fdty_db_url');
    const aiKey = getStoredKey('fdty_deepseek_key');
    const groupSelector = ':is(#Panel1, #Panel2, #Panel3) table:is([id^="repVer_rbtn_ver_"], [id^="repSin_RadioButtonList1_"])';
    let status;
    let aiError = '';
    let detectedModel;
    let bank = new Map();

    function notify(message) {
        if (status) status.textContent = message;
        console.info(message);
    }

    function stripUnimportantChars(str) {
        return str.replace(/[ 　\t\r\n,，\.。:：“”《》？?！!~～｀`【】()_—\-＿－（）<>、\/\\"'`]/g, '').toLowerCase();
    }

    function normalizeAnswer(value) {
        const text = String(value).trim().toLowerCase();
        if (text === 'true' || text === '1') return true;
        if (text === 'false' || text === '0') return false;
        if (/^[a-d]$/.test(text)) return text.toUpperCase();
    }

    function indexBank(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('题库格式错误');
        const index = new Map();
        for (const [stem, value] of Object.entries(data)) {
            const key = stripUnimportantChars(stem);
            const answer = normalizeAnswer(value);
            if (key && answer !== undefined) {
                // 规范化后同题异答，留给 AI 或用户核对。
                index.set(key, index.has(key) && index.get(key) !== answer ? null : answer);
            }
        }
        if (!index.size) throw Error('题库为空');
        return index;
    }

    // 旧的独立源以 JavaScript 发布，部分不提供 CORS。把它放在独立的匿名源里读取。
    function readScriptBank(url) {
        return new Promise((resolve, reject) => {
            const frame = document.createElement('iframe');
            frame.hidden = true;
            frame.setAttribute('sandbox', 'allow-scripts');
            frame.referrerPolicy = 'no-referrer';
            const timer = setTimeout(() => finish(null), 12000);
            function finish(data) {
                clearTimeout(timer);
                window.removeEventListener('message', receive);
                frame.remove();
                if (data) resolve(data);
                else reject(Error('题库加载失败'));
            }
            function receive(event) {
                if (event.source === frame.contentWindow && event.origin === 'null') finish(event.data);
            }
            window.addEventListener('message', receive);
            const script = document.createElement('script');
            script.src = url;
            script.referrerPolicy = 'no-referrer';
            script.setAttribute('onload', 'parent.postMessage(window.fdty_database || null, "*")');
            script.setAttribute('onerror', 'parent.postMessage(null, "*")');
            frame.srcdoc = '<!doctype html><meta charset="utf-8">' + script.outerHTML;
            document.body.append(frame);
        });
    }

    async function readBank(rawUrl) {
        const url = new URL(rawUrl, location.href);
        if (!['http:', 'https:'].includes(url.protocol)) throw Error('无效题库地址');
        try {
            const response = await fetch(url, {credentials: 'omit', signal: AbortSignal.timeout(8000)});
            if (!response.ok) throw Error('题库 HTTP ' + response.status);
            const body = (await response.text()).trim().replace(/^var\s+fdty_database\s*=\s*/, '').replace(/;$/, '');
            return indexBank(JSON.parse(body));
        } catch (error) {
            if (url.origin === location.origin || !(error instanceof TypeError)) throw error;
            return indexBank(await readScriptBank(url.href));
        }
    }

    function readQuestion(group) {
        const parts = [];
        for (let node = group.previousSibling; node; node = node.previousSibling) {
            if (node.nodeType === Node.COMMENT_NODE) continue;
            if (node.nodeType === 1 && node.matches('table, .fonttitle')) break;
            parts.unshift(node.textContent);
        }
        const stem = parts.join(' ').trim().match(/^(\d+)\s*[.．、]\s*([\s\S]+)$/);
        const choice = group.id.startsWith('repSin_');
        const inputs = Array.from(group.querySelectorAll('input[type="radio"]'));
        const labels = choice ? inputs.map(input =>
            Array.from(input.labels || [], label => label.textContent.trim()).join(' ').trim()) : [];
        const options = choice && labels.length >= 2 && labels.every(Boolean)
            ? inputs.map((input, i) => input.value + '：' + labels[i]).join('\n') : '';
        const number = stem ? stem[1] : group.id;
        return {group, inputs, options, type: choice ? 'choice' : 'trueOrFalse',
            text: stem ? stem[2].trim() : '', label: (choice ? '单选 ' : '判断 ') + number};
    }

    function checked(q) {
        return q.group.isConnected && q.group.querySelector('input[type="radio"]:checked');
    }

    function fill(q, answer, sourceName) {
        if (checked(q) || !q.group.isConnected) return false;
        if (q.type === 'trueOrFalse' ? typeof answer !== 'boolean' : typeof answer !== 'string') return false;
        const input = q.inputs.find(input => q.group.contains(input) && !input.matches(':disabled') &&
            normalizeAnswer(input.value) === answer);
        if (!input) return false;
        input.click();
        if (!input.checked) return false;
        q.applied = input;
        q.source = sourceName;
        return true;
    }

    function distance(a, b, limit) {
        let prev = Array.from({length: b.length + 1}, (_, i) => i);
        let next = Array(b.length + 1);
        for (let i = 1; i <= a.length; i++) {
            next[0] = i;
            let min = i;
            for (let j = 1; j <= b.length; j++) {
                next[j] = Math.min(prev[j] + 1, next[j-1] + 1, prev[j-1] + Number(a[i-1] !== b[j-1]));
                min = Math.min(min, next[j]);
            }
            if (min > limit) return limit + 1;
            [prev, next] = [next, prev];
        }
        return prev[b.length];
    }

    function similar(q, key) {
        const core = stripUnimportantChars(q.text.replace(/\([^)]*\)|（[^）]*）|【[^】]*】|\[[^\]]*\]/g, ''));
        const limit = Math.floor(key.length * 0.22);
        const found = [];
        for (const [stem, answer] of bank) {
            if (typeof answer !== (q.type === 'choice' ? 'string' : 'boolean')) continue;
            const delta = Math.abs(stem.length - key.length);
            const contained = core.length >= 4 && stem.includes(core);
            if (delta > limit && !contained) continue;
            const diff = delta > limit ? delta : distance(key, stem, limit);
            if (diff <= limit || contained) found.push({stem, answer, diff});
        }
        return found.sort((a, b) => a.diff - b.diff);
    }

    var DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
    var DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/models';

    // 读取本地配置的 Key。AI 答题是可选功能：没配 Key 就完全不用，不打扰用户。
    function getStoredKey(name) {
        try {
            var v = sessionStorage.getItem(name) || localStorage.getItem(name);
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
        if (!candidates.length) return null;
        candidates.sort(function (a, b) { return scoreModel(b) - scoreModel(a); });
        return candidates[0];
    }

    async function detectDeepSeekModel(apiKey, callback, refresh = false) {
        const configured = getStoredKey('fdty_deepseek_model');
        if (configured || detectedModel) { callback(configured || detectedModel); return; }

        // 只缓存模型名、时间和密钥指纹。旧 HTTP 页面可能没有 SubtleCrypto。
        let fingerprint, cached;
        try {
            const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
            fingerprint = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
            const entry = JSON.parse(sessionStorage.getItem('fdty_model_cache'));
            if (!refresh && entry?.fingerprint === fingerprint) cached = entry;
        } catch (e) {}
        if (cached && Date.now() - cached.time < 86400000) {
            detectedModel = cached.model;
        } else {
            try {
                const response = await fetch(DEEPSEEK_MODELS_URL, {
                    headers: {Authorization: 'Bearer ' + apiKey},
                    signal: AbortSignal.timeout(12000)
                });
                if (!response.ok) throw Error('模型列表 HTTP ' + response.status);
                const {data} = await response.json();
                detectedModel = pickModel(data.map(model => model.id));
                if (!detectedModel) throw Error('可用模型列表为空');
                if (fingerprint) {
                    const entry = {fingerprint, model: detectedModel, time: Date.now()};
                    try { sessionStorage.setItem('fdty_model_cache', JSON.stringify(entry)); } catch (e) {}
                }
            } catch (error) {
                detectedModel = cached?.model;
                if (!detectedModel) aiError = error.message;
                console.warn('读取 DeepSeek 模型失败：' + error.message);
            }
        }
        callback(detectedModel);
    }

    // 可选：联网搜索（Tavily），把结果作为参考资料喂给 AI
    function searchWeb(query, callback) {
        var tavilyKey = getStoredKey('fdty_tavily_key');
        if (!tavilyKey) { callback(''); return; }
        fetch('https://api.tavily.com/search', {
            signal: AbortSignal.timeout(8000),
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: tavilyKey, query: query, max_results: 3, search_depth: 'basic' })
        }).then(function (r) { return r.json(); }).then(function (d) {
            var refs = (d.results || []).map(function (x) { return (x.title || '') + ': ' + (x.content || ''); });
            callback(refs.join('\n'));
        }).catch(function () { callback(''); });
    }

    function parseDeepSeekAnswers(content, count) {
        const byIndex = new Map();
        const lines = String(content).replace(/(\d+\s*[.、:：)\]])/g, '\n$1').split('\n');
        for (const line of lines) {
            const item = line.trim().match(/^(\d+)\s*[.、:：)\]]\s*(?:应该选|应选|选)?\s*(正确|错误|对|错|[A-D])\s*[。.]?$/i);
            if (!item) continue;
            const index = Number(item[1]) - 1;
            if (index < 0 || index >= count) continue;
            const token = item[2].toUpperCase();
            const answer = /^[A-D]$/.test(token) ? token : ['正确', '对'].includes(token);
            // 重复且矛盾的答案进入补问，不能由输出顺序决定。
            byIndex.set(index, byIndex.has(index) && byIndex.get(index) !== answer ? null : answer);
        }
        return Array.from(byIndex, ([index, answer]) => ({index, answer})).filter(item => item.answer !== null);
    }

    // 发送一次对话请求。HTTP 错误也把 API 的 message 带出来，便于判断该走哪种自愈重试。
    function postChat(apiKey, payload, onSuccess, onError) {
        fetch(DEEPSEEK_API, {
            signal: AbortSignal.timeout(60000),
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
                var err = new Error(r.status === 401 ? 'API Key 无效或已过期' : String(msg).replaceAll(apiKey, '[Key]'));
                err.status = r.status;
                throw err;
            });
        }).then(function (data) {
            onSuccess((data && data.choices && data.choices[0]) || {});
        }).catch(onError);
    }

    function askDeepSeek(questions, callback) {
        var apiKey = aiKey;
        if (!apiKey) { callback(null); return; }   // 未配置 Key：完全静默跳过，AI 答题为可选功能

        var lines = questions.map(function (q, i) {
            return (i + 1) + '.[' + (q.type === 'trueOrFalse' ? '判断题' : '单选题') + ']' + q.text +
                (q.options ? '\n当前选项：\n' + q.options : '') +
                (q.hints ? '\n相似题参考（原题及旧答案）：' + q.hints : '');
        });
        var basePrompt = '你是复旦体育理论考试答题助手。请根据体育知识回答以下题目。\n' +
            '输出要求：每题一行，格式为“序号.答案”。判断题答案只写“对”或“错”；单选题答案只写选项字母 A/B/C/D。\n' +
            '按当前题干及选项独立判断，留意否定、数字和顺序变化。相似题的旧答案仅供参考。无法判断可写 ?。只输出答案。\n';

        var triedModelRetry = false, triedRelax = false, triedStripParams = false;
        // 是否开启思考模式，默认关闭。为什么默认关——以题库答案为基准，40 题 × 各 6 轮实测：
        //   关闭思考：               准确率 92.5%，思考 0 tokens，     耗时 1.3 秒，6 轮结果完全一致
        //   开启思考+reasoning_effort=low：准确率 90.8%，思考约 3900 tokens，耗时 23.2 秒，每轮有波动
        //   差 1.7 个百分点、标准误 2.5 个百分点 → 在噪声范围内，没有可测量的提升。
        // 两处佐证：两种配置里始终答错的是同样 3 道题（多半是题库答案本身有误，思考也救不回来）；
        // 而开思考会额外引入新的偶发错误，结果不再可复现——考试工具里可复现比"多想一步"更重要。
        // 更要紧的是思考与答案共用 max_tokens，预算不够时 content 直接为空、答案全丢
        // （旧版固定 3000 正是踩了这个坑，实测 40 题 0/40）。
        // 注：reasoning_effort 本身是有效的（v4-pro 上 low 能把思考从 ~990 降到 ~28 tokens），
        // 但真正决定"要不要思考"的是 thinking 参数。
        // 想自己对比：localStorage.setItem('fdty_deepseek_thinking', 'on')
        var thinkingOn = false;
        try { thinkingOn = localStorage.getItem('fdty_deepseek_thinking') === 'on'; } catch (e) {}
        // 预算按题量推算，而不是固定写死：关思考实测约 4 tokens/题，开思考约 150 tokens/题，这里各留足余量
        var maxTokens = Math.max(3000, questions.length * (thinkingOn ? 400 : 60));

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
                max_tokens: triedRelax ? maxTokens * 3 : maxTokens
            };
            if (!triedStripParams) {
                payload.temperature = 0.1;
                // 关键：默认显式关闭思考模式（原因见上面 thinkingOn 处的实测数据）。
                // 不显式关的话，deepseek-flash 默认就开思考，会跟答案抢 max_tokens。
                payload.thinking = { type: thinkingOn ? 'enabled' : 'disabled' };
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
                if (!triedModelRetry && [400, 404].includes(err.status) && /model/i.test(m)) {
                    triedModelRetry = true;
                    detectedModel = null;
                    // 手动指定的模型名（fdty_deepseek_model）也可能已下架：一并清掉，
                    // 否则重新探测会直接命中这个覆盖值、又拿回同一个坏名字。
                    try { localStorage.removeItem('fdty_deepseek_model'); } catch (e) {}
                    console.warn('当前模型不可用（' + m + '），正在重新探测模型…');
                    try {
                        sessionStorage.removeItem('fdty_deepseek_model');
                        sessionStorage.removeItem('fdty_model_cache');
                    } catch (e) {}
                    detectDeepSeekModel(apiKey, function (newModel) {
                        if (!newModel) { console.error('DeepSeek 调用失败：无法获取可用模型'); callback(null); return; }
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
                aiError = m;
                console.error('DeepSeek 调用失败：' + m);
                callback(null);
            });
        };

        detectDeepSeekModel(apiKey, function (model) {
            if (!model) {
                aiError = aiError || '未能取得可用模型';
                console.error('DeepSeek 调用失败：' + aiError);
                callback(null);
                return;
            }
            console.info('使用模型：' + model);
            // 若配置了 Tavily，先并发搜索（最多 5 题，避免过慢）
            var tavilyKey = getStoredKey('fdty_tavily_key');
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

    function prepare(q) {
        if (checked(q) || !q.text || !q.inputs.some(input => !input.matches(':disabled'))) return false;
        const key = stripUnimportantChars(q.text);
        if (!key || fill(q, bank.get(key), '题库')) return false;
        const candidates = similar(q, key);
        if (aiKey) {
            if (q.type === 'choice' && !q.options) return false;
            q.hints = candidates.slice(0, 3).map(c => c.stem + ' → ' + c.answer).join('\n');
            return true;
        }
        for (const candidate of candidates) {
            if (confirm(q.text + '\n' + candidate.stem + '\n这两题是否一样？')) {
                fill(q, candidate.answer, '题库');
                break;
            }
        }
        return false;
    }

    async function resolvePending(questions) {
        let remaining = questions;
        for (let round = 0; round < 2 && remaining.length; round++) {
            notify('DeepSeek 正在' + (round ? '补答' : '处理') + remaining.length + '题…');
            const answers = await new Promise(resolve => askDeepSeek(remaining, resolve));
            if (!answers) break;
            for (const {index, answer} of answers) {
                const q = remaining[index];
                const current = readQuestion(q.group);
                if (current.text === q.text && current.options === q.options) fill(q, answer, 'AI');
            }
            remaining = remaining.filter(q => {
                if (!q.group.isConnected || checked(q)) return false;
                const current = readQuestion(q.group);
                return current.text === q.text && current.options === q.options;
            });
        }
    }

    function showAiReview(questions) {
        if (!questions.length) return;
        const details = document.createElement('details');
        details.id = 'fdty-ai-review';
        const summary = document.createElement('summary');
        summary.textContent = '核对 AI 填写的 ' + questions.length + ' 题';
        const list = document.createElement('ul');
        for (const q of questions) {
            const item = document.createElement('li');
            const link = document.createElement('a');
            link.href = '#' + q.group.id;
            const value = normalizeAnswer(q.applied.value);
            const answer = typeof value === 'boolean' ? (value ? '对' : '错') : value;
            link.textContent = q.label + ' · ' + answer + ' · ' + q.text;
            item.append(link);
            list.append(item);
        }
        details.append(summary, list);
        status.after(details);
    }

    async function run() {
        let groups;
        for (let i = 0; i < 50; i++) {
            groups = document.querySelectorAll(groupSelector);
            if (groups.length) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!groups.length) throw Error('未找到判断题或单选题，请在显示试题的 paper 框架中运行。');
        status = document.getElementById('fdty-status') || document.createElement('p');
        document.getElementById('fdty-ai-review')?.remove();
        status.id = 'fdty-status';
        status.setAttribute('role', 'status');
        groups[0].closest('[id^="Panel"]').before(status);
        notify('正在读取题库…');
        for (const url of new Set([customBank, bundledBank].filter(Boolean))) {
            try {
                bank = await readBank(url);
                const origin = new URL(url, location.href).origin;
                console.info((url === bundledBank ? '随脚本题库' : '自定义题库') + '已载入：' + bank.size + ' 条（' + origin + '）');
                break;
            } catch (error) {
                console.warn('题库读取失败：' + error.message);
            }
        }
        if (!bank.size) console.warn('题库不可用。已启用 AI 时将直接按页面题目作答。');
        const questions = Array.from(document.querySelectorAll(groupSelector), readQuestion);
        const pending = questions.filter(prepare);
        await resolvePending(pending);
        const counts = {题库: 0, AI: 0, 已选: 0};
        const missing = [];
        const aiQuestions = [];
        for (const q of questions) {
            const input = checked(q);
            if (!input) {
                missing.push(q.label);
                continue;
            }
            const source = input === q.applied ? q.source : '已选';
            counts[source]++;
            if (source === 'AI') aiQuestions.push(q);
        }
        showAiReview(aiQuestions);
        notify('程序完成。共 ' + questions.length + ' 题，题库填写 ' + counts.题库 +
            '，AI 填写 ' + counts.AI + '，保留已选 ' + counts.已选 + '，待处理 ' + missing.length +
            (missing.length ? '（' + missing.join('、') + '）' : '') + (aiError ? '。DeepSeek：' + aiError : '') + '。请核对后手动交卷。');
    }

    window.fdtyRunning = true;
    try {
        try { localStorage.removeItem('fdty_detected_model_key'); } catch (e) {}
        await run();
    } catch (error) {
        notify('处理未完成：' + error.message);
    } finally {
        delete window.fdtyRunning;
    }
})();
