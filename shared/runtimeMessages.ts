import { normalizeLanguageCode, type SupportedLanguageCode } from "./languages";

type RuntimeCopy = {
  topicNotFound: string;
  topicNotFoundNextStep: string;
  providerFallbackNotice: string;
  importantPoints: string;
  topicWisePoints: string;
  simplerPoints: string;
  sourceQuestions: string;
  noMorePoints: string;
  topicLabel: string;
  sourceLabel: string;
  answerLabel: string;
  shortAnswerLabel: string;
  nextForMore: string;
};

const COPY: Record<SupportedLanguageCode, RuntimeCopy> = {
  en: {
    topicNotFound: "This topic was not found in the selected study material.",
    topicNotFoundNextStep: "Try another file, ask a more specific question, or use Web Search.",
    providerFallbackNotice: "Generated from your selected study material while AI providers are unavailable.",
    importantPoints: "Important points from the selected material:",
    topicWisePoints: "Topic-wise points from the selected material:",
    simplerPoints: "Here are the main ideas in simpler steps:",
    sourceQuestions: "Questions from the selected material:",
    noMorePoints: "No more distinct points were found in the selected material.",
    topicLabel: "Topic",
    sourceLabel: "Source",
    answerLabel: "Answer",
    shortAnswerLabel: "Short answer",
    nextForMore: "Type next for more from this file.",
  },
  hi: {
    topicNotFound: "यह विषय चुनी गई अध्ययन सामग्री में नहीं मिला।",
    topicNotFoundNextStep: "दूसरी फ़ाइल चुनें, अधिक स्पष्ट प्रश्न पूछें, या वेब खोज का उपयोग करें।",
    providerFallbackNotice: "AI सेवा उपलब्ध न होने के कारण यह उत्तर आपकी चुनी गई अध्ययन सामग्री से बनाया गया है।",
    importantPoints: "चुनी गई सामग्री के महत्वपूर्ण बिंदु:", topicWisePoints: "चुनी गई सामग्री के विषयवार बिंदु:",
    simplerPoints: "मुख्य विचार सरल चरणों में:", sourceQuestions: "चुनी गई सामग्री से प्रश्न:",
    noMorePoints: "चुनी गई सामग्री में अन्य अलग बिंदु नहीं मिले।", topicLabel: "विषय", sourceLabel: "स्रोत",
    answerLabel: "उत्तर", shortAnswerLabel: "संक्षिप्त उत्तर", nextForMore: "इस फ़ाइल से और पढ़ने के लिए next लिखें।",
  },
  te: {
    topicNotFound: "ఈ విషయం ఎంచుకున్న అధ్యయన పాఠ్యంలో కనిపించలేదు.",
    topicNotFoundNextStep: "మరొక ఫైల్ ఎంచుకోండి, మరింత స్పష్టమైన ప్రశ్న అడగండి, లేదా వెబ్ సెర్చ్ ఉపయోగించండి.",
    providerFallbackNotice: "AI సేవ అందుబాటులో లేనందున ఎంచుకున్న అధ్యయన పాఠ్యం ఆధారంగా ఈ సమాధానం రూపొందించబడింది.",
    importantPoints: "ఎంచుకున్న పాఠ్యంలోని ముఖ్యమైన అంశాలు:", topicWisePoints: "ఎంచుకున్న పాఠ్యంలోని అంశాల వారీ పాయింట్లు:",
    simplerPoints: "ప్రధాన భావాలు సులభమైన దశల్లో:", sourceQuestions: "ఎంచుకున్న పాఠ్యం ఆధారంగా ప్రశ్నలు:",
    noMorePoints: "ఎంచుకున్న పాఠ్యంలో మరిన్ని ప్రత్యేక అంశాలు కనిపించలేదు.", topicLabel: "విషయం", sourceLabel: "మూలం",
    answerLabel: "సమాధానం", shortAnswerLabel: "చిన్న సమాధానం", nextForMore: "ఈ ఫైల్ నుంచి మరిన్ని అంశాల కోసం next అని టైప్ చేయండి.",
  },
  ta: {
    topicNotFound: "இந்தத் தலைப்பு தேர்ந்தெடுத்த படிப்புப் பொருளில் காணப்படவில்லை.",
    topicNotFoundNextStep: "வேறு கோப்பைத் தேர்ந்தெடுக்கவும், தெளிவான கேள்வியைக் கேட்கவும், அல்லது இணையத் தேடலைப் பயன்படுத்தவும்.",
    providerFallbackNotice: "AI சேவை கிடைக்காததால் தேர்ந்தெடுத்த படிப்புப் பொருளிலிருந்து இந்தப் பதில் உருவாக்கப்பட்டது.",
    importantPoints: "தேர்ந்தெடுத்த படிப்புப் பொருளின் முக்கிய குறிப்புகள்:", topicWisePoints: "தலைப்பு வாரியான குறிப்புகள்:",
    simplerPoints: "முக்கிய கருத்துகள் எளிய படிகளில்:", sourceQuestions: "தேர்ந்தெடுத்த படிப்புப் பொருளிலிருந்து கேள்விகள்:",
    noMorePoints: "மேலும் தனித்த குறிப்புகள் கிடைக்கவில்லை.", topicLabel: "தலைப்பு", sourceLabel: "ஆதாரம்",
    answerLabel: "பதில்", shortAnswerLabel: "சுருக்கமான பதில்", nextForMore: "மேலும் காண next எனத் தட்டச்சு செய்யவும்.",
  },
  kn: {
    topicNotFound: "ಈ ವಿಷಯವು ಆಯ್ಕೆ ಮಾಡಿದ ಅಧ್ಯಯನ ಸಾಮಗ್ರಿಯಲ್ಲಿ ಕಂಡುಬಂದಿಲ್ಲ.",
    topicNotFoundNextStep: "ಬೇರೆ ಫೈಲ್ ಆಯ್ಕೆಮಾಡಿ, ಹೆಚ್ಚು ಸ್ಪಷ್ಟವಾದ ಪ್ರಶ್ನೆ ಕೇಳಿ, ಅಥವಾ ವೆಬ್ ಹುಡುಕಾಟ ಬಳಸಿ.",
    providerFallbackNotice: "AI ಸೇವೆ ಲಭ್ಯವಿಲ್ಲದ ಕಾರಣ ಆಯ್ಕೆ ಮಾಡಿದ ಅಧ್ಯಯನ ಸಾಮಗ್ರಿಯಿಂದ ಈ ಉತ್ತರವನ್ನು ರಚಿಸಲಾಗಿದೆ.",
    importantPoints: "ಆಯ್ಕೆ ಮಾಡಿದ ಸಾಮಗ್ರಿಯ ಪ್ರಮುಖ ಅಂಶಗಳು:", topicWisePoints: "ವಿಷಯವಾರು ಅಂಶಗಳು:",
    simplerPoints: "ಮುಖ್ಯ ವಿಚಾರಗಳು ಸರಳ ಹಂತಗಳಲ್ಲಿ:", sourceQuestions: "ಆಯ್ಕೆ ಮಾಡಿದ ಸಾಮಗ್ರಿಯಿಂದ ಪ್ರಶ್ನೆಗಳು:",
    noMorePoints: "ಇನ್ನಷ್ಟು ವಿಭಿನ್ನ ಅಂಶಗಳು ಕಂಡುಬಂದಿಲ್ಲ.", topicLabel: "ವಿಷಯ", sourceLabel: "ಮೂಲ",
    answerLabel: "ಉತ್ತರ", shortAnswerLabel: "ಸಂಕ್ಷಿಪ್ತ ಉತ್ತರ", nextForMore: "ಇನ್ನಷ್ಟು ವಿಷಯಕ್ಕಾಗಿ next ಎಂದು ಟೈಪ್ ಮಾಡಿ.",
  },
  ml: {
    topicNotFound: "ഈ വിഷയം തിരഞ്ഞെടുത്ത പഠനസാമഗ്രിയിൽ കണ്ടെത്തിയില്ല.",
    topicNotFoundNextStep: "മറ്റൊരു ഫയൽ തിരഞ്ഞെടുക്കുക, കൂടുതൽ വ്യക്തമായ ചോദ്യം ചോദിക്കുക, അല്ലെങ്കിൽ വെബ് തിരയൽ ഉപയോഗിക്കുക.",
    providerFallbackNotice: "AI സേവനം ലഭ്യമല്ലാത്തതിനാൽ തിരഞ്ഞെടുത്ത പഠനസാമഗ്രിയിൽ നിന്ന് ഈ ഉത്തരം തയ്യാറാക്കി.",
    importantPoints: "തിരഞ്ഞെടുത്ത പഠനസാമഗ്രിയിലെ പ്രധാന കാര്യങ്ങൾ:", topicWisePoints: "വിഷയം തിരിച്ചുള്ള കാര്യങ്ങൾ:",
    simplerPoints: "പ്രധാന ആശയങ്ങൾ ലളിതമായ ഘട്ടങ്ങളിൽ:", sourceQuestions: "തിരഞ്ഞെടുത്ത പഠനസാമഗ്രിയിൽ നിന്നുള്ള ചോദ്യങ്ങൾ:",
    noMorePoints: "കൂടുതൽ വ്യത്യസ്ത കാര്യങ്ങൾ കണ്ടെത്തിയില്ല.", topicLabel: "വിഷയം", sourceLabel: "ഉറവിടം",
    answerLabel: "ഉത്തരം", shortAnswerLabel: "ചുരുക്ക ഉത്തരം", nextForMore: "കൂടുതലിനായി next എന്ന് ടൈപ്പ് ചെയ്യുക.",
  },
  mr: {
    topicNotFound: "हा विषय निवडलेल्या अभ्यास साहित्यात आढळला नाही.",
    topicNotFoundNextStep: "दुसरी फाइल निवडा, अधिक स्पष्ट प्रश्न विचारा, किंवा वेब शोध वापरा.",
    providerFallbackNotice: "AI सेवा उपलब्ध नसल्यामुळे हे उत्तर निवडलेल्या अभ्यास साहित्यातून तयार केले आहे.",
    importantPoints: "निवडलेल्या साहित्याचे महत्त्वाचे मुद्दे:", topicWisePoints: "विषयानुसार मुद्दे:",
    simplerPoints: "मुख्य कल्पना सोप्या टप्प्यांत:", sourceQuestions: "निवडलेल्या साहित्यातील प्रश्न:",
    noMorePoints: "आणखी वेगळे मुद्दे आढळले नाहीत.", topicLabel: "विषय", sourceLabel: "स्रोत",
    answerLabel: "उत्तर", shortAnswerLabel: "थोडक्यात उत्तर", nextForMore: "अधिक माहितीसाठी next टाइप करा.",
  },
  bn: {
    topicNotFound: "এই বিষয়টি নির্বাচিত অধ্যয়ন উপকরণে পাওয়া যায়নি।",
    topicNotFoundNextStep: "অন্য ফাইল নির্বাচন করুন, আরও নির্দিষ্ট প্রশ্ন করুন, অথবা ওয়েব সার্চ ব্যবহার করুন।",
    providerFallbackNotice: "AI পরিষেবা অনুপলব্ধ থাকায় নির্বাচিত অধ্যয়ন উপকরণ থেকে এই উত্তর তৈরি করা হয়েছে।",
    importantPoints: "নির্বাচিত উপকরণের গুরুত্বপূর্ণ বিষয়:", topicWisePoints: "বিষয়ভিত্তিক পয়েন্ট:",
    simplerPoints: "মূল ধারণাগুলি সহজ ধাপে:", sourceQuestions: "নির্বাচিত উপকরণ থেকে প্রশ্ন:",
    noMorePoints: "আর কোনো আলাদা পয়েন্ট পাওয়া যায়নি।", topicLabel: "বিষয়", sourceLabel: "উৎস",
    answerLabel: "উত্তর", shortAnswerLabel: "সংক্ষিপ্ত উত্তর", nextForMore: "আরও জানতে next টাইপ করুন।",
  },
};

export function localizedRuntimeCopy(language: unknown): RuntimeCopy {
  return COPY[normalizeLanguageCode(language)];
}
