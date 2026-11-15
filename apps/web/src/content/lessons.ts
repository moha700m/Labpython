export interface Lesson {
  id: string;
  titleAr: string;
  level: "مبتدئ" | "متوسط";
  paragraphs: string[];
  example: string;
  exercise: {
    promptAr: string;
    starter: string;
    stdin?: string;
    /** Exact expected stdout (trimmed, line endings normalized). */
    expected: string;
    hintAr: string;
  };
}

export const LESSONS: Lesson[] = [
  {
    id: "hello",
    titleAr: "1. برنامجك الأول",
    level: "مبتدئ",
    paragraphs: [
      "كل برنامج C++ يبدأ من الدالة main. ما بين القوسين { } هو ما ينفّذه الحاسوب بالترتيب.",
      "السطر ‎#include <iostream>‎ يضيف مكتبة الإدخال والإخراج، و std::cout يطبع على الشاشة.",
      "لاحظ أن كل جملة تنتهي بفاصلة منقوطة ; — نسيانها هو أكثر خطأ شائع عند المبتدئين.",
    ],
    example: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!\\n";\n    return 0;\n}\n',
    exercise: {
      promptAr: "اكتب برنامجاً يطبع السطرين: Salam ثم C++ (كل كلمة في سطر).",
      starter: '#include <iostream>\n\nint main() {\n    // اكتب هنا\n    return 0;\n}\n',
      expected: "Salam\nC++",
      hintAr: "استخدم std::cout مرتين، وأضف \\n في نهاية كل سطر.",
    },
  },
  {
    id: "variables",
    titleAr: "2. المتغيرات والعمليات",
    level: "مبتدئ",
    paragraphs: [
      "المتغير صندوق له نوع واسم وقيمة: int للأعداد الصحيحة، double للكسور، std::string للنصوص.",
      "يمكنك الجمع + والطرح - والضرب * والقسمة /. قسمة عددين صحيحين تُسقط الكسر: 7 / 2 تساوي 3.",
    ],
    example: '#include <iostream>\n\nint main() {\n    int a = 7;\n    int b = 2;\n    std::cout << a + b << "\\n";\n    std::cout << a / b << "\\n";\n    std::cout << 7.0 / 2 << "\\n";\n}\n',
    exercise: {
      promptAr: "عرّف متغيرين width = 6 و height = 4 واطبع المساحة (حاصل الضرب) فقط.",
      starter: "#include <iostream>\n\nint main() {\n    \n}\n",
      expected: "24",
      hintAr: "int width = 6; int height = 4; ثم std::cout << width * height;",
    },
  },
  {
    id: "input",
    titleAr: "3. القراءة من المستخدم",
    level: "مبتدئ",
    paragraphs: [
      "std::cin يقرأ قيمة من لوحة المفاتيح ويضعها في متغير. يتوقف عند أول مسافة.",
      "لقراءة سطر كامل يحتوي مسافات استخدم std::getline(std::cin, text).",
    ],
    example: '#include <iostream>\n\nint main() {\n    int age;\n    std::cout << "Age? ";\n    std::cin >> age;\n    std::cout << "Next year: " << age + 1 << "\\n";\n}\n',
    exercise: {
      promptAr: "اقرأ عددين صحيحين من الإدخال واطبع مجموعهما. (سنرسل للبرنامج: 15 27)",
      starter: "#include <iostream>\n\nint main() {\n    \n}\n",
      stdin: "15 27\n",
      expected: "42",
      hintAr: "int x, y; std::cin >> x >> y; std::cout << x + y;",
    },
  },
  {
    id: "loops",
    titleAr: "4. الشروط والحلقات",
    level: "مبتدئ",
    paragraphs: [
      "if تنفّذ كوداً عند تحقق شرط، و else عند عدم تحققه.",
      "حلقة for تكرر كوداً عدداً محدداً من المرات: for (int i = 1; i <= 5; ++i).",
    ],
    example: '#include <iostream>\n\nint main() {\n    for (int i = 1; i <= 5; ++i) {\n        if (i % 2 == 0) std::cout << i << " even\\n";\n        else std::cout << i << " odd\\n";\n    }\n}\n',
    exercise: {
      promptAr: "اطبع مضاعفات العدد 3 من 3 إلى 15، كل عدد في سطر.",
      starter: "#include <iostream>\n\nint main() {\n    \n}\n",
      expected: "3\n6\n9\n12\n15",
      hintAr: "for (int i = 3; i <= 15; i += 3) std::cout << i << '\\n';",
    },
  },
  {
    id: "functions",
    titleAr: "5. الدوال",
    level: "متوسط",
    paragraphs: [
      "الدالة تجمع كوداً قابلاً لإعادة الاستخدام: لها نوع إرجاع واسم ووسائط.",
      "عرّف الدالة قبل استخدامها، أو اكتب إعلانها (prototype) في الأعلى.",
    ],
    example: '#include <iostream>\n\nint square(int x) {\n    return x * x;\n}\n\nint main() {\n    std::cout << square(9) << "\\n";\n}\n',
    exercise: {
      promptAr: "اكتب دالة max3 تُرجع أكبر الأعداد الثلاثة، واطبع max3(4, 19, 7).",
      starter: "#include <iostream>\n\n// int max3(int a, int b, int c) { ... }\n\nint main() {\n    \n}\n",
      expected: "19",
      hintAr: "يمكنك استخدام std::max من <algorithm>: return std::max({a, b, c});",
    },
  },
  {
    id: "vectors",
    titleAr: "6. الحاويات: std::vector",
    level: "متوسط",
    paragraphs: [
      "std::vector مصفوفة يتغير حجمها تلقائياً. أضف عنصراً بـ push_back واعرف الحجم بـ size().",
      "حلقة for (auto x : v) تمر على كل العناصر بأمان دون أخطاء حدود المصفوفة.",
    ],
    example: '#include <iostream>\n#include <vector>\n\nint main() {\n    std::vector<int> v{5, 3, 8};\n    v.push_back(1);\n    int sum = 0;\n    for (int x : v) sum += x;\n    std::cout << v.size() << " " << sum << "\\n";\n}\n',
    exercise: {
      promptAr: "خزّن الأعداد 4 8 15 16 23 42 في vector واطبع مجموعها.",
      starter: "#include <iostream>\n#include <vector>\n\nint main() {\n    \n}\n",
      expected: "108",
      hintAr: "std::vector<int> v{4, 8, 15, 16, 23, 42}; ثم اجمع بحلقة.",
    },
  },
];
