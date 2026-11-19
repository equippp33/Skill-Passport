import { describe, expect, it } from "vitest";

import {
  isDeclineRequest,
  isExplainRequest,
  isGiveUpRequest,
  isRepeatRequest,
  isSkipRequest,
} from "~/config/repeat-requests";

describe("isDeclineRequest (follow-up 'no')", () => {
  it("recognises a plain no, in several languages", () => {
    for (const no of [
      "No",
      "No.",
      "No sir",
      "No no",
      "Nope",
      "Not really",
      "No, thank you",
      "Nahi",
      "नहीं",
      "नाही सर",
      "नको",
      "இல்லை",
    ]) {
      expect(isDeclineRequest(no)).toBe(true);
    }
  });

  it("never mistakes a real answer that contains 'no' for a decline", () => {
    for (const answer of [
      "No, I would first apologise to the customer",
      "I have no experience but I would ask my senior",
      "Not sure, maybe I would check the stock",
      "नहीं, मैं पहले ग्राहक से माफी मांगूंगा",
      "Yes",
      "",
    ]) {
      expect(isDeclineRequest(answer)).toBe(false);
    }
  });
});

describe("isExplainRequest", () => {
  it("recognises explanation requests in several languages", () => {
    for (const ask of [
      "Can you explain the question?",
      "Please explain",
      "I didn't understand",
      "What do you mean?",
      "Samjhao",
      "Samajh nahi aaya",
      "समझ नहीं आया",
      "मला कळलं नाही",
      "समजावून सांगा",
      "Explain in Hindi",
      "Hindi mein samjhao",
      "புரியவில்லை",
    ]) {
      expect(isExplainRequest(ask)).toBe(true);
    }
  });

  it("does not treat real answers as explanation requests", () => {
    for (const answer of [
      "I would explain it to the customer politely",
      "Matlab, main pehle customer se sorry bolunga",
      "I speak Marathi at home with my family",
      "First I would apologise and then offer another item from the shop",
      "Repeat",
      "I will ask them again if I don't understand.",
      "एकदा समजून घ्यायचं आणि मग समोरच्याला समजून सांगायचं.",
    ]) {
      expect(isExplainRequest(answer)).toBe(false);
    }
  });
});

describe("requests in every interview language", () => {
  it("recognises skip / next", () => {
    for (const s of [
      "नेक्स्ट क्वेश्चन प्लीज",
      "प्लीज नेक्स्ट क्वेश्चन",
      "स्किप",
      "नेक्स्ट",
      "அடுத்த கேள்வி",
      "ಮುಂದಿನ ಪ್ರಶ್ನೆ",
      "পরের প্রশ্ন",
      "આગળનો પ્રશ્ન",
      "അടുത്ത ചോദ്യം",
      "ਅਗਲਾ ਸਵਾਲ",
      "ପରବର୍ତ୍ତୀ ପ୍ରଶ୍ନ",
      "తదుపరి ప్రశ్న",
    ]) {
      expect(isSkipRequest(s)).toBe(true);
    }
  });

  it("recognises 'I don't know'", () => {
    for (const s of [
      "मला माहित नाही",
      "मुझे नहीं पता",
      "எனக்கு தெரியாது",
      "నాకు తెలియదు",
      "ನನಗೆ ಗೊತ್ತಿಲ್ಲ",
      "আমি জানি না",
      "મને ખબર નથી",
      "എനിക്ക് അറിയില്ല",
      "ਮੈਨੂੰ ਨਹੀਂ ਪਤਾ",
      "ମୁଁ ଜାଣେ ନାହିଁ",
    ]) {
      expect(isGiveUpRequest(s)).toBe(true);
    }
  });

  it("recognises repeat", () => {
    for (const s of [
      "रिपीट करो",
      "रिपीट",
      "फिर से बोलिए",
      "மீண்டும் சொல்லுங்கள்",
      "ఇంకోసారి చెప్పండి",
      "ಇನ್ನೊಮ್ಮೆ ಹೇಳಿ",
      "আরেকবার বলুন",
      "ફરી એકવાર કહો",
      "ഒന്നുകൂടി പറയൂ",
      "ਇੱਕ ਵਾਰ ਫਿਰ ਦੱਸੋ",
      "ଆଉ ଥରେ କୁହନ୍ତୁ",
    ]) {
      expect(isRepeatRequest(s)).toBe(true);
    }
  });

  it("recognises a plain 'no' on a follow-up", () => {
    for (const s of ["नो", "ନା", "Illa", "Ledu"]) {
      expect(isDeclineRequest(s)).toBe(true);
    }
  });
});

describe("real answers are not mistaken for requests", () => {
  it("keeps answers that mention next / repeat", () => {
    expect(isSkipRequest("नेक्स्ट टाइम ध्यान रखूंगा वो गलती ना हो।")).toBe(
      false,
    );
    expect(isRepeatRequest("मैं उस से रिपीट करने के लिए कहूँगा")).toBe(false);
  });
});

/**
 * The three follow-up / repeat behaviours, said the way a candidate who chose
 * each language would actually say them.
 */
describe("each interview language, in its own words", () => {
  const byLanguage: Record<
    string,
    { no: string; repeat: string; explain: string }
  > = {
    english: {
      no: "No sir",
      repeat: "Can you repeat?",
      explain: "I didn't understand",
    },
    hindi: { no: "नहीं जी", repeat: "फिर से बोलिए", explain: "समझ नहीं आया" },
    marathi: {
      no: "नाही सर",
      repeat: "पुन्हा सांगा",
      explain: "मला कळलं नाही",
    },
    tamil: {
      no: "இல்லை சார்",
      repeat: "திரும்ப சொல்லுங்க",
      explain: "எனக்கு புரியல",
    },
    telugu: {
      no: "లేదు సార్",
      repeat: "మళ్ళీ చెప్పండి",
      explain: "నాకు అర్థం కాలేదు",
    },
    kannada: {
      no: "ಇಲ್ಲ ಸರ್",
      repeat: "ಇನ್ನೊಮ್ಮೆ ಹೇಳಿ",
      explain: "ನನಗೆ ಅರ್ಥ ಆಗಲಿಲ್ಲ",
    },
    bengali: { no: "না থাক", repeat: "আবার বলুন", explain: "আমি বুঝিনি" },
    gujarati: { no: "ના સર", repeat: "ફરી કહો", explain: "મને સમજ ન પડી" },
    malayalam: {
      no: "ഇല്ല സർ",
      repeat: "ഒന്നുകൂടി പറയൂ",
      explain: "എനിക്ക് മനസ്സിലായില്ല",
    },
    punjabi: { no: "ਨਹੀਂ ਜੀ", repeat: "ਫਿਰ ਤੋਂ ਦੱਸੋ", explain: "ਸਮਝ ਨਹੀਂ ਆਈ" },
    odia: {
      no: "ନା ସାର୍",
      repeat: "ପୁଣି ଥରେ କୁହନ୍ତୁ",
      explain: "ମୁଁ ବୁଝିଲି ନାହିଁ",
    },
  };

  for (const [language, said] of Object.entries(byLanguage)) {
    it(`${language}: "no" declines a follow-up`, () => {
      expect(isDeclineRequest(said.no)).toBe(true);
    });
    it(`${language}: "repeat" replays the question`, () => {
      expect(isRepeatRequest(said.repeat)).toBe(true);
      expect(isExplainRequest(said.repeat)).toBe(false);
    });
    it(`${language}: "didn't understand" gets an explanation`, () => {
      expect(isExplainRequest(said.explain)).toBe(true);
    });
  }
});
