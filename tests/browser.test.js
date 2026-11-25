const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.join(__dirname, '..');
const origin = 'http://127.0.0.1:8080';
let browser;
before(async () => {
    browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE});
});
after(async () => { await browser?.close(); });

function fixture(stems) {
    return '<meta charset="utf-8"><div id="Panel3">' + stems.map((stem, index) => {
        const options = [0, 1].map(v =>
            '<label><input type="radio" name="q' + index + '" value="' + v + '">' + v + '</label>');
        return (index + 1) + '. ' + stem + '<table id="repVer_rbtn_ver_' + (10 + index) +
            '"><tr><td>' + options.join('') + '</td></tr></table>';
    }).join('\n') + '</div>';
}

async function open(t, {html, bank, ai, chat, file, confirm = false}) {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const requests = [];
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.href === 'https://api.deepseek.com/models' && ai)
            return route.fulfill({json: {data: [{id: 'deepseek-flash'}]}});
        if (url.href === 'https://api.deepseek.com/chat/completions' && ai) {
            const prompt = route.request().postDataJSON().messages.at(-1).content;
            requests.push(prompt);
            return chat(route, prompt, requests.length);
        }
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/paper') return route.fulfill({contentType: 'text/html; charset=utf-8',
            body: html || await readFile(path.join(root, file))});
        if (url.pathname === '/database.js' && bank)
            return route.fulfill({body: 'var fdty_database=' + JSON.stringify(bank)});
        if (['/database.js', '/fdty.js'].includes(url.pathname))
            return route.fulfill({contentType: 'application/javascript', body: await readFile(path.join(root, url.pathname))});
        return route.fulfill({status: 404, body: ''});
    });
    await page.goto(origin + '/paper');
    await page.evaluate(({ai, confirm}) => {
        window.confirmCount = 0;
        window.confirm = () => { window.confirmCount++; return confirm; };
        if (ai) sessionStorage.setItem('fdty_deepseek_key', 'test-only');
    }, {ai, confirm});
    return {page, requests};
}

async function start(page) { await page.addScriptTag({url: origin + '/fdty.js'}); }
async function done(page) {
    await page.waitForFunction(() => document.querySelector('#fdty-status')?.textContent.includes('程序完成'));
    return page.locator('#fdty-status').innerText();
}

for (const [file, count] of [['testpage.html', 40], ['testpage2.html', 45]]) {
    test(file + ' retains bank-only coverage', async t => {
        const {page} = await open(t, {file});
        await start(page);
        assert.match(await done(page), /共 50 题/);
        assert.equal(await page.locator('input:checked').count(), count);
    });
}

test('legacy string judgments bind to their actual controls and preserve an existing selection', async t => {
    const {page} = await open(t, {html: fixture(['样例甲', '样例乙', '样例丙']), bank: {样例甲:'false', 样例乙:true, 样例丙:false}});
    await page.locator('[name=q2][value="1"]').check();
    await start(page);
    assert.match(await done(page), /题库填写 2，AI 填写 0，保留已选 1，待处理 0/);
    assert.deepEqual(await page.locator('input:checked').evaluateAll(es => es.map(e => e.value)), ['0','1','1']);
});

test('AI handles similar stems, manual changes during a request, and partial replies', {timeout:15000}, async t => {
    let release, started;
    const pending = new Promise(resolve => { release = resolve; });
    const received = new Promise(resolve => { started = resolve; });
    const {page, requests} = await open(t, {ai: true, html: fixture(['跑步应当做好热身', '跑步不应当做好热身','全新的测试问题','另一道库外测试题']),
        bank: {跑步应当做好热身:true}, chat: async (route, _, n) => {
            if (n === 1) { started(); await pending; }
            await route.fulfill({json: {choices: [{message: {content: n === 1 ? '1.错\n2.对' : '1.对'}}]}});
        }});
    await start(page);
    await received;
    await start(page);
    assert.match(await page.locator('#fdty-status').innerText(), /正在处理/);
    await page.locator('[name=q2][value="0"]').check();
    release();
    assert.match(await done(page), /题库填写 1，AI 填写 2，保留已选 1，待处理 0/);
    assert.deepEqual(await page.locator('input:checked').evaluateAll(es => es.map(e => e.value)), ['1','0','0','1']);
    assert.equal(await page.evaluate(() => window.confirmCount), 0);
    assert.equal(requests.length, 2);
    assert.deepEqual(await page.locator('#fdty-ai-review a').evaluateAll(links => links.map(a => a.hash)),
        ['#repVer_rbtn_ver_11', '#repVer_rbtn_ver_13']);
    assert.match(requests[0], /相似题参考.*跑步应当做好热身/);
    assert.doesNotMatch(requests[1], /另一道库外测试题[\s\S]*全新的测试问题|跑步不应当做好热身/);
    assert.match(requests[1], /另一道库外测试题/);
});

test('a failed API call leaves a single final list of unresolved questions', async t => {
    const {page, requests} = await open(t, {ai:true, html:fixture(['样例甲','样例乙']), bank:{样例甲:true},
        chat: route => route.fulfill({status:401, json:{error:{message:'invalid'}}})});
    await start(page);
    assert.match(await done(page), /题库填写 1，AI 填写 0，保留已选 0，待处理 1（判断 2）/);
    assert.equal(requests.length, 1);
});

test('custom bank failure falls back to the bundled bank', async t => {
    const {page} = await open(t, {html:fixture(['样例甲']), bank:{样例甲:false}});
    await page.addScriptTag({url: origin + '/fdty.js?db=/unavailable'});
    assert.match(await done(page), /题库填写 1/);
});

test('a bank served without CORS can be read in the isolated legacy loader', async t => {
    const {page} = await open(t, {html:fixture(['样例甲']), bank:{样例甲:false}});
    const external = 'https://bank.example.test/legacy.js';
    // A different answer from each source makes unintended fallback observable.
    await page.route(external, route => {
        if (route.request().resourceType() === 'fetch') return route.abort('failed');
        return route.fulfill({contentType:'application/javascript',body:'var fdty_database={"样例甲":true};'});
    });
    await page.addScriptTag({url: origin + '/fdty.js?db=' + encodeURIComponent(external)});
    assert.match(await done(page), /题库填写 1/);
    assert.equal(await page.locator('input:checked').inputValue(), '1');
});

test('a missing bank still allows AI and final counts match the page', async t => {
    const {page} = await open(t, {html:fixture(['库外题']), bank:{}, ai:true,
        chat: route => route.fulfill({json:{choices:[{message:{content:'1.对'}}]}})});
    await start(page);
    assert.match(await done(page), /题库填写 0，AI 填写 1，保留已选 0，待处理 0/);
});

test('without a key, accepting a similar stem still uses the confirmed bank answer', async t => {
    const {page} = await open(t, {html:fixture(['跑步之前应该充分热身']), bank:{跑步之前应充分热身:true}, confirm:true});
    await start(page);
    assert.match(await done(page), /题库填写 1，AI 填写 0/);
    assert.equal(await page.evaluate(() => window.confirmCount), 1);
});

test('the current choice labels reach AI and the returned letter binds to its value', async t => {
    const html = '<div id="Panel1">7. 请选择测试选项<table id="repSin_RadioButtonList1_94"><tr><td>' +
        ['C', 'A', 'D', 'B'].map(letter => '<label><input type="radio" name="choice" value="' + letter +
            '">' + letter + '选项内容</label>').join('') + '</td></tr></table></div>';
    const {page, requests} = await open(t, {html, ai:true, bank:{其他题:'c'},
        chat: route => route.fulfill({json:{choices:[{message:{content:'1.选B'}}]}})});
    await start(page);
    assert.match(await done(page), /AI 填写 1/);
    assert.match(requests[0], /C：C选项内容[\s\S]*A：A选项内容[\s\S]*D：D选项内容[\s\S]*B：B选项内容/);
    assert.equal(await page.locator('input:checked').inputValue(), 'B');
});
