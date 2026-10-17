// test/chatlog.test.js — 对局对话记录：封存格式、**「游戏」标识**、参与者块、
// 违禁词等长替换、以及 7 天清理。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createChatLog, pruneChatLogs, CHAT_LOG_GAME, DEFAULT_CHAT_LOG_DIR } from '../server/chatlog.js';
import { filterChat } from '../server/chatFilter.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sp-chatlog-'));

describe('对局对话记录 (chatlog)', () => {
  test('the record carries the game tag, the participants block and the transcript', () => {
    const dir = tmpDir();
    const t = (ms) => 1_700_000_000_000 + ms;
    const log = createChatLog({ roomCode: 'ABCD', matchNo: 3, mode: 'versus', difficulty: 'ABYSS', dir, now: () => t(0) });
    log.addMember({ playerId: 'p_0', name: '甲', ip: '1.2.3.4', role: '玩家' });
    log.addMember({ playerId: 'p_1', name: '乙', ip: '5.6.7.8', role: '玩家' });
    log.addMember({ playerId: 'p_2', name: '看客', ip: '9.9.9.9', role: '观众(中途加入)' });
    log.addMessage({ playerId: 'p_0', text: '你好' });
    log.addMessage({ playerId: 'p_1', text: '****', censored: true });
    const file = log.seal();
    const text = fs.readFileSync(file, 'utf8');

    assert.equal(path.dirname(file), dir);
    assert.match(path.basename(file), /^\d{8}-\d{6}-ABCD\.log$/);
    assert.equal(CHAT_LOG_GAME, '狩猎', 'this fork tags its records 狩猎');
    assert.match(text, /^# 卫戍协议：狩猎模拟 · 对局对话记录/m);
    assert.match(text, /^游戏：狩猎$/m);
    assert.match(text, /^房间号：ABCD$/m);
    assert.match(text, /^模式：versus（ABYSS）$/m);
    assert.match(text, /^对局序号：#3$/m);
    assert.match(text, /^消息数：2$/m);
    assert.match(text, /\[玩家\] 名称=甲 \| IP=1\.2\.3\.4/);
    assert.match(text, /名称=乙 \| IP=5\.6\.7\.8/);
    assert.match(text, /\[观众\(中途加入\)\] 名称=看客/);
    assert.match(text, /甲：你好$/m);
    assert.match(text, /乙：\*\*\*\*（已过滤）$/m, 'the transcript keeps the (filtered) mark');
    assert.equal(log.seal(), file, 'seal is idempotent');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the default dir is outside public/ and data/, and 7-day-old records are pruned', () => {
    assert.ok(DEFAULT_CHAT_LOG_DIR.endsWith('对话记录'), DEFAULT_CHAT_LOG_DIR);
    assert.ok(!/public|data/.test(path.relative(path.join(path.dirname(DEFAULT_CHAT_LOG_DIR)), DEFAULT_CHAT_LOG_DIR)), 'not under public/ or data/');
    const dir = tmpDir();
    const old = path.join(dir, 'old.log');
    fs.writeFileSync(old, 'x');
    const longAgo = Date.now() - 8 * 86_400_000;
    fs.utimesSync(old, longAgo / 1000, longAgo / 1000);
    const fresh = path.join(dir, 'fresh.log');
    fs.writeFileSync(fresh, 'x');
    assert.equal(pruneChatLogs(dir, Date.now(), { info() {}, warn() {}, error() {}, debug() {} }), 1);
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(fresh), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('filterChat masks a hit with an equal-length run of asterisks', () => {
    const r = filterChat('禁止词来了，禁止词又来了', ['禁止词']);
    assert.equal(r.censored, true);
    assert.equal(r.text, '***来了，***又来了');
    assert.equal(r.text.length, '禁止词来了，禁止词又来了'.length, 'positions/length preserved');
    assert.deepEqual(r.hits, ['禁止词']);
    assert.equal(filterChat('干净的一句话', ['禁止词']).censored, false);
  });
});
