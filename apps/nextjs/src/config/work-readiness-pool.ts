/**
 * The FIXED "Work Readiness & Aspirations" question pool.
 *
 * This is the ONLY skill drawn from a fixed bank — every other skill is
 * AI-generated. One question is picked at random per interview. English, Hindi
 * and Marathi are stored verbatim (client-finalised) and used as-is; any other
 * interview language renders the English version live at runtime.
 */
export interface ReadinessQuestion {
  en: string;
  hi: string;
  mr: string;
}

export const WORK_READINESS_QUESTIONS: ReadinessQuestion[] = [
  {
    en: "Why do you want a job?",
    hi: "आपको जॉब क्यों करनी है?",
    mr: "तुम्हाला नोकरी का करायची आहे?",
  },
  {
    en: "What do you look for in your first job — salary, learning, benefits, or something else?",
    hi: "अपनी पहली जॉब में आप क्या देखते हैं — सैलरी, लर्निंग, बेनिफिट्स, या कुछ और?",
    mr: "तुमच्या पहिल्या नोकरीत तुम्ही कोणत्या गोष्टींना प्राधान्य देता — पगार, शिकण्याची संधी, सुविधा (Benefits) किंवा इतर काही?",
  },
  {
    en: "What is a good salary to start with?",
    hi: "शुरुआत के लिए अच्छी सैलरी कितनी होनी चाहिये?",
    mr: "तुमच्या मते सुरुवातीला योग्य पगार किती असावा?",
  },
  {
    en: "Are you okay working night shifts or on weekends?",
    hi: "क्या आप नाइट शिफ्ट या वीकेंड पर काम करने के लिए तैयार हैं?",
    mr: "तुम्हाला नाईट शिफ्ट किंवा वीकेंडला काम करण्याची तयारी आहे का?",
  },
  {
    en: "Are you ready to move to another city for a job?",
    hi: "क्या आप जॉब के लिए दूसरे शहर जाने को तैयार हैं?",
    mr: "नोकरीच्या संधीसाठी तुम्ही दुसऱ्या शहरात स्थलांतर करण्यास तयार आहात का?",
  },
  {
    en: "Are you okay starting in a junior role and learning on the job?",
    hi: "क्या आप जूनियर रोल से शुरू करके काम करते-करते सीखने के लिए तैयार हैं?",
    mr: "कनिष्ठ पदापासून सुरुवात करून काम करताना नवीन कौशल्ये शिकण्यास तुम्ही तयार आहात का?",
  },
  {
    en: "Where do you want to be in your career in two years?",
    hi: "दो साल में आप अपने करियर में कहाँ पहुँचना चाहते हो?",
    mr: "पुढील दोन वर्षांत तुम्हाला तुमच्या करिअरमध्ये कुठे पोहोचायचे आहे?",
  },
  {
    en: "What kind of work environment do you enjoy — for example, an office, a lab, on site or in the field, or travelling?",
    hi: "आपको किस प्रकार का कार्य वातावरण पसंद है? जैसे — ऑफिस में काम करना / लैब में काम करना / साइट या फील्ड पर काम करना / यात्रा करना आदि।",
    mr: "तुम्हाला कोणत्या प्रकारच्या कामाच्या वातावरणात काम करायला आवडते? उदा. ऑफिस, लॅब, साइट/फील्ड, प्रवासाचे काम इ.",
  },
  {
    en: "Do you want a transport facility from the company for the job?",
    hi: "क्या आप नौकरी के लिए कंपनी द्वारा प्रदान की जाने वाली परिवहन सुविधा लेना पसंद करेंगे?",
    mr: "नोकरीसाठी कंपनीकडून वाहतूक सुविधा उपलब्ध असल्यास तुम्हाला ती सुविधा हवी आहे का?",
  },
  {
    en: "Are you comfortable working under pressure to meet targets?",
    hi: "क्या आप दबाव में काम करने और निर्धारित लक्ष्यों (Targets) को पूरा करने में सक्षम हैं?",
    mr: "कामाचा दबाव असताना किंवा दिलेले लक्ष्य (Target) पूर्ण करण्यासाठी काम करण्यास तुम्ही सक्षम आहात का?",
  },
  {
    en: "How much time will you require to join if selected?",
    hi: "यदि आपका चयन होता है, तो आप नौकरी जॉइन करने के लिए कितने समय में उपलब्ध हो सकते हैं?",
    mr: "तुमची निवड झाल्यास तुम्ही किती दिवसांत नोकरीवर रुजू होऊ शकता?",
  },
];
