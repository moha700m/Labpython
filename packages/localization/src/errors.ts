/**
 * Arabic explanations for common GCC / Clang / MSVC / linker diagnostics.
 * Each rule matches the raw (English) compiler message and returns a short
 * beginner-friendly explanation plus a concrete fix suggestion.
 */
export interface ErrorExplanation {
  explanationAr: string;
  suggestionAr: string;
}

interface Rule {
  test: RegExp;
  explain: (m: RegExpMatchArray) => ErrorExplanation;
}

const q = (s: string | undefined) => (s ? `«${s}»` : "");

const STD_HEADERS: Record<string, string> = {
  cout: "<iostream>", cin: "<iostream>", cerr: "<iostream>", endl: "<iostream>",
  string: "<string>", vector: "<vector>", map: "<map>", unordered_map: "<unordered_map>",
  set: "<set>", sort: "<algorithm>", max: "<algorithm>", min: "<algorithm>", array: "<array>",
  unique_ptr: "<memory>", shared_ptr: "<memory>", make_unique: "<memory>", thread: "<thread>",
  mutex: "<mutex>", optional: "<optional>", variant: "<variant>", function: "<functional>",
  setw: "<iomanip>", setprecision: "<iomanip>", ifstream: "<fstream>", ofstream: "<fstream>",
  stringstream: "<sstream>", printf: "<cstdio>", sqrt: "<cmath>", pow: "<cmath>", format: "<format>",
  println: "<print>", span: "<span>", ranges: "<ranges>",
};

const RULES: Rule[] = [
  {
    test: /['‘`«]?(\w+)['’`»]? is not a member of ['‘`]?std['’`]?|no member named '(\w+)' in namespace 'std'/,
    explain: (m) => {
      const name = m[1] ?? m[2];
      const header = name ? STD_HEADERS[name] : undefined;
      return {
        explanationAr: `الاسم ${q(name)} غير موجود داخل std لأن ملف الترويسة الخاص به لم يُضمَّن.`,
        suggestionAr: header ? `أضف السطر ‎#include ${header}‎ في أعلى الملف.` : "تأكد من تضمين ملف الترويسة الصحيح (#include) لهذا الاسم.",
      };
    },
  },
  {
    test: /['‘`]?(\w+)['’`]? was not declared in this scope|use of undeclared identifier '(\w+)'|'(\w+)': undeclared identifier/,
    explain: (m) => {
      const name = m[1] ?? m[2] ?? m[3];
      const header = name ? STD_HEADERS[name] : undefined;
      return {
        explanationAr: `المعرّف ${q(name)} مستخدم قبل أن يُعرَّف، أو أن اسمه مكتوب بشكل خاطئ.`,
        suggestionAr: header
          ? `إن كنت تقصد std::${name} فأضف ‎#include ${header}‎ واكتب std::${name} أو استخدم using namespace std.`
          : "عرّف المتغير أو الدالة قبل استخدامها، وتحقق من تطابق الأحرف الكبيرة والصغيرة.",
      };
    },
  },
  {
    test: /expected ['‘`]?;['’`]?|expected ';'/,
    explain: () => ({
      explanationAr: "توجد فاصلة منقوطة (;) مفقودة. في C++ تنتهي كل جملة بفاصلة منقوطة.",
      suggestionAr: "أضف ; في نهاية السطر السابق للسطر المشار إليه.",
    }),
  },
  {
    test: /expected ['‘`]?[})\]]['’`]?|expected '[})\]]'|expected declaration or statement at end of input|unbalanced/,
    explain: () => ({
      explanationAr: "يوجد قوس غير مُغلق أو مُغلق في غير مكانه.",
      suggestionAr: "راجع تطابق الأقواس { } و ( ) و [ ] — كل قوس مفتوح يحتاج قوس إغلاق مقابل.",
    }),
  },
  {
    test: /undefined reference to `?(?:WinMain|wWinMain)/,
    explain: () => ({
      explanationAr: "الرابط يبحث عن WinMain لأن البرنامج مُعدّ كتطبيق واجهة رسومية، بينما الكود يحتوي main فقط (أو العكس).",
      suggestionAr: "من إعدادات البناء غيّر «نظام Windows الفرعي» إلى Console، أو عرّف دالة WinMain لتطبيقات الواجهة.",
    }),
  },
  {
    test: /undefined reference to [`'‘]?([^'’`]+)['’`]?|unresolved external symbol "?([^"]+)"?|Undefined symbols/,
    explain: (m) => ({
      explanationAr: `خطأ ربط (Linker): الدالة أو المتغير ${q((m[1] ?? m[2] ?? "").slice(0, 80))} مُعلَن لكن تعريفه غير موجود في أي ملف مُترجَم.`,
      suggestionAr: "تأكد من كتابة جسم الدالة، ومن إضافة ملف .cpp الذي يحتويها للمشروع، أو أضف المكتبة المطلوبة في خيارات الربط (مثل -lgdi32).",
    }),
  },
  {
    test: /multiple definition of [`'‘]?([^'’`]+)|already defined in/,
    explain: (m) => ({
      explanationAr: `الرمز ${q(m[1])} مُعرَّف أكثر من مرة في ملفات مختلفة.`,
      suggestionAr: "انقل التعريف إلى ملف .cpp واحد واترك الإعلان فقط في ملف .h، أو استخدم inline للتعريفات في ملفات الترويسة.",
    }),
  },
  {
    test: /fatal error: ([^:]+): No such file or directory|'([^']+)' file not found|Cannot open include file: '([^']+)'/,
    explain: (m) => ({
      explanationAr: `ملف الترويسة ${q(m[1] ?? m[2] ?? m[3])} غير موجود.`,
      suggestionAr: "تحقق من اسم الملف ومساره. للملفات المحلية استخدم \"file.h\" وللمكتبات القياسية <file>.",
    }),
  },
  {
    test: /redefinition of ['‘`]?([^'’`]+)|redeclared|conflicting declaration/,
    explain: (m) => ({
      explanationAr: `تمت إعادة تعريف ${q(m[1])} في نفس النطاق.`,
      suggestionAr: "احذف التعريف المكرر أو غيّر الاسم. لملفات الترويسة أضف #pragma once في أولها.",
    }),
  },
  {
    test: /no matching function for call to ['‘`]?([^'’`(]+)|no matching (?:member )?function for call to '([^']+)'/,
    explain: (m) => ({
      explanationAr: `لا توجد نسخة من الدالة ${q(m[1] ?? m[2])} تقبل هذه الوسائط (عددها أو أنواعها مختلفة).`,
      suggestionAr: "قارن الوسائط التي تمررها مع تعريف الدالة. اقرأ الملاحظات (note) التي تلي الخطأ لمعرفة النسخ المتاحة.",
    }),
  },
  {
    test: /cannot convert|invalid conversion from|no viable conversion|cannot initialize/,
    explain: () => ({
      explanationAr: "تحاول وضع قيمة من نوع في متغير من نوع آخر غير متوافق.",
      suggestionAr: "تأكد من تطابق الأنواع، أو استخدم تحويلاً صريحاً مثل static_cast<int>(x) أو std::stoi للنصوص.",
    }),
  },
  {
    test: /does not name a type|unknown type name '(\w+)'/,
    explain: (m) => ({
      explanationAr: `المترجم لا يعرف النوع ${q(m[1])}. قد يكون ملف الترويسة غير مُضمَّن أو أن الاسم خاطئ.`,
      suggestionAr: "أضف #include المناسب أو استخدم std:: قبل أنواع المكتبة القياسية مثل std::string.",
    }),
  },
  {
    test: /lvalue required|expression is not assignable/,
    explain: () => ({
      explanationAr: "تحاول الإسناد إلى شيء لا يمكن تغييره (مثل رقم ثابت أو نتيجة عملية).",
      suggestionAr: "هل كنت تقصد المقارنة == بدلاً من الإسناد =؟",
    }),
  },
  {
    test: /control reaches end of non-void function|non-void function does not return a value/,
    explain: () => ({
      explanationAr: "الدالة يجب أن تُرجع قيمة، لكن يوجد مسار تنتهي فيه بدون return.",
      suggestionAr: "أضف return بقيمة مناسبة في نهاية الدالة وفي كل الفروع.",
    }),
  },
  {
    test: /unused variable ['‘`]?(\w+)/,
    explain: (m) => ({
      explanationAr: `المتغير ${q(m[1])} مُعرَّف لكنه غير مستخدم.`,
      suggestionAr: "احذفه إن لم تكن بحاجة إليه، أو استخدمه.",
    }),
  },
  {
    test: /comparison of integer expressions of different signedness|comparison of integers of different signs/,
    explain: () => ({
      explanationAr: "مقارنة بين عدد بإشارة (int) وعدد بدون إشارة (size_t)، وقد تعطي نتيجة غير متوقعة مع القيم السالبة.",
      suggestionAr: "استخدم std::size_t لعداد الحلقة عند المقارنة مع v.size()، أو حلقة for (auto& x : v).",
    }),
  },
  {
    test: /is used uninitialized|may be used uninitialized|variable '(\w+)' is uninitialized/,
    explain: () => ({
      explanationAr: "يُقرأ متغير قبل إعطائه قيمة ابتدائية، فقيمته عشوائية.",
      suggestionAr: "أعطِ المتغير قيمة عند تعريفه، مثل int x = 0;",
    }),
  },
  {
    test: /suggest parentheses around assignment used as truth value|using the result of an assignment as a condition/,
    explain: () => ({
      explanationAr: "استخدمت = (إسناد) داخل شرط، والأرجح أنك تقصد == (مقارنة).",
      suggestionAr: "استبدل = بـ == داخل if أو while.",
    }),
  },
  {
    test: /stray ['‘`]?\\?\d*['’`]? in program|non-ASCII characters are not allowed/,
    explain: () => ({
      explanationAr: "يوجد حرف غير مسموح في الكود، غالباً علامة اقتباس عربية أو مسافة خاصة نُسخت من مستند.",
      suggestionAr: "أعد كتابة السطر يدوياً باستخدام علامات الاقتباس الإنجليزية \" و '.",
    }),
  },
  {
    test: /missing terminating ["'] character/,
    explain: () => ({
      explanationAr: "نص (string) لم يُغلق بعلامة اقتباس.",
      suggestionAr: "أضف \" في نهاية النص على نفس السطر.",
    }),
  },
  {
    test: /'main' must return 'int'|::main' must return 'int'/,
    explain: () => ({
      explanationAr: "الدالة main يجب أن تُرجع int في C++.",
      suggestionAr: "اكتب int main() بدلاً من void main().",
    }),
  },
];

export function explainDiagnostic(message: string): ErrorExplanation | undefined {
  for (const rule of RULES) {
    const m = message.match(rule.test);
    if (m) return rule.explain(m);
  }
  return undefined;
}

export function explainRuntimeExit(exitCode: number | null, signal?: string | null): string | undefined {
  if (signal === "SIGSEGV" || exitCode === 139 || exitCode === -1073741819 || exitCode === 3221225477) {
    return "انهار البرنامج بسبب وصول غير صالح للذاكرة (Segmentation fault / Access violation): غالباً مؤشر فارغ، أو تجاوز حدود مصفوفة.";
  }
  if (signal === "SIGFPE" || exitCode === 136 || exitCode === -1073741676) {
    return "انهار البرنامج بسبب عملية حسابية غير صالحة، غالباً قسمة عدد صحيح على صفر.";
  }
  if (signal === "SIGABRT" || exitCode === 134 || exitCode === 3) {
    return "توقف البرنامج عبر abort() — غالباً استثناء غير معالَج (uncaught exception) أو فشل assert.";
  }
  if (signal === "SIGKILL" || exitCode === 137) {
    return "أُوقف البرنامج لأنه تجاوز حدود الوقت أو الذاكرة المسموح بها.";
  }
  if (signal === "SIGXCPU" || exitCode === 152) {
    return "أُوقف البرنامج لأنه تجاوز حد وقت المعالج المسموح (ربما حلقة لا نهائية).";
  }
  return undefined;
}
