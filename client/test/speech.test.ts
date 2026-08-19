import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessSpeechLang } from '../src/speech.ts';

test('guessSpeechLang picks English by default', () => {
  assert.equal(guessSpeechLang('serendipity'), 'en-US');
});

test('guessSpeechLang detects CJK, kana, and hangul', () => {
  assert.equal(guessSpeechLang('間隔重複'), 'zh-TW');
  assert.equal(guessSpeechLang('ひらがな'), 'ja-JP');
  assert.equal(guessSpeechLang('한글'), 'ko-KR');
});
