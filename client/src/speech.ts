/** Browser Web Speech API helpers for vocabulary pronunciation. */

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
}

/** Pick a BCP-47 voice locale from the written text. */
export function guessSpeechLang(text: string): string {
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-TW';
  if (/[\u3040-\u30ff]/.test(text)) return 'ja-JP';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko-KR';
  return 'en-US';
}

type SpeechListener = (activeText: string) => void;
const listeners = new Set<SpeechListener>();

export function onSpeechChange(fn: SpeechListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(activeText: string) {
  for (const fn of listeners) fn(activeText);
}

function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const existing = synth.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const finish = () => resolve(synth.getVoices());
    const timer = window.setTimeout(finish, 400);
    synth.addEventListener(
      'voiceschanged',
      () => {
        window.clearTimeout(timer);
        finish();
      },
      { once: true }
    );
  });
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined {
  const lower = lang.toLowerCase();
  const prefix = lower.slice(0, 2);
  return (
    voices.find((v) => v.lang.toLowerCase() === lower) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix))
  );
}

let speakToken = 0;

export function stopSpeaking() {
  speakToken += 1;
  if (!isSpeechSupported()) {
    notify('');
    return;
  }
  window.speechSynthesis.cancel();
  notify('');
}

export async function speak(text: string): Promise<void> {
  const value = text.trim();
  if (!isSpeechSupported() || !value) return;
  speakToken += 1;
  const token = speakToken;
  window.speechSynthesis.cancel();
  const voices = await waitForVoices();
  if (token !== speakToken) return;
  const utter = new SpeechSynthesisUtterance(value);
  utter.lang = guessSpeechLang(value);
  utter.rate = 0.92;
  const voice = pickVoice(voices, utter.lang);
  if (voice) utter.voice = voice;
  notify(value);
  await new Promise<void>((resolve) => {
    utter.onend = () => {
      if (token === speakToken) notify('');
      resolve();
    };
    utter.onerror = () => {
      if (token === speakToken) notify('');
      resolve();
    };
    window.speechSynthesis.speak(utter);
  });
}
