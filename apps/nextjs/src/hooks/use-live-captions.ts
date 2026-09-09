"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * Live captions while the candidate speaks.
 *
 * These come from the browser's own SpeechRecognition engine, NOT from
 * Sarvam, and that distinction matters:
 *
 *  - they are a display aid only. Nothing here is stored, scored, or sent to
 *    the server. The authoritative transcript is the one Sarvam returns after
 *    the answer is submitted, which is what lands in
 *    `interview_turns.answer_transcript`;
 *  - support is patchy. Chrome and Edge implement it, Firefox does not, and
 *    quality on Indic languages varies. Everything degrades to no captions
 *    rather than an error;
 *  - the engine stops on its own after a pause, so it is restarted for as
 *    long as the caller says recording is active.
 *
 * Using the browser here avoids streaming a second copy of the audio to
 * Sarvam purely to draw text on screen.
 */

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      0: { transcript: string };
    };
  };
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useLiveCaptions(options: {
  /** Start and stop with the recorder. */
  active: boolean;
  /** BCP-47 of the interview language; the probe uses a neutral default. */
  languageCode: string;
}) {
  const { active, languageCode } = options;

  const [text, setText] = useState("");

  /**
   * Feature detection without a setState-in-effect: the server snapshot is
   * false and the client snapshot reads the real API, so there is no
   * hydration mismatch and no extra render pass.
   */
  const supported = useSyncExternalStore(
    () => () => undefined,
    () => getRecognitionCtor() !== null,
    () => false,
  );

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  /** Distinguishes an automatic pause-stop from the caller stopping us. */
  const wantActiveRef = useRef(false);
  /**
   * The engine restarts itself after every silence, so `onstart` fires many
   * times per answer. Only the first one may clear the text — otherwise the
   * captions would blank out mid-sentence each time the candidate pauses.
   */
  const clearedThisRunRef = useRef(false);

  const stop = useCallback(() => {
    wantActiveRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      try {
        recognition.abort();
      } catch {
        // Already stopped; nothing to do.
      }
    }
  }, []);

  useEffect(() => {
    if (!active) {
      stop();
      return;
    }

    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    wantActiveRef.current = true;
    clearedThisRunRef.current = false;

    const start = () => {
      if (!wantActiveRef.current) return;

      let recognition: SpeechRecognitionLike;
      try {
        recognition = new Ctor();
      } catch {
        return;
      }

      recognition.lang = languageCode;
      recognition.continuous = true;
      recognition.interimResults = true;

      // Clearing here rather than in the effect body keeps the state write in
      // an event handler, where it does not cascade a render.
      recognition.onstart = () => {
        if (clearedThisRunRef.current) return;
        clearedThisRunRef.current = true;
        finalRef.current = "";
        setText("");
      };

      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;
          const chunk = result[0].transcript;
          if (result.isFinal) finalRef.current += chunk;
          else interim += chunk;
        }
        setText((finalRef.current + interim).trim());
      };

      // A failure just means no captions — never surface it to the candidate.
      recognition.onerror = () => undefined;

      // The engine ends itself after a silence; restart while still recording.
      recognition.onend = () => {
        if (wantActiveRef.current) start();
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        // Overlapping start; the onend handler will retry.
      }
    };

    start();
    return stop;
  }, [active, languageCode, stop]);

  return { text, supported };
}
