#!/usr/bin/env bash
# Writes OPEN_SITE.md (opened automatically in the Codespace) with a tappable link to the site.
cd "$(dirname "$0")/.."
URL="${1:-}"
WORKERS="${2:-}"
if [ -z "$URL" ]; then
  if [ -n "${CODESPACE_NAME:-}" ]; then URL="https://${CODESPACE_NAME}-4000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}/run/"; else URL="http://localhost:4000/run/"; fi
fi
if [ -n "$WORKERS" ]; then STATUS="✅ المنصة شغّالة (العمال: $WORKERS)"; else STATUS="⏳ المنصة لسا تجهّز… انتظر دقيقة، أو شغّل في الطرفية: bash .devcontainer/start.sh"; fi
cat > OPEN_SITE.md <<MD
# 👇 اضغط الرابط لفتح الموقع

## [افتح Muhammad C++ Studio]($URL)

$URL

$STATUS

---

**ما فتح؟**

1. انتظر دقيقة واضغط الرابط مرة ثانية (أول تشغيل ياخذ وقت).
2. إذا طلب تسجيل دخول GitHub، سجّل — الرابط خاص بحسابك.
3. إذا ما زال ما يفتح: افتح القائمة ☰ ← Terminal ← New Terminal، واكتب:

\`\`\`
bash .devcontainer/start.sh
\`\`\`

   وبيطلع لك الرابط في آخر سطر.
4. أو من تبويب **PORTS** (المنافذ) تحت: اضغط أيقونة 🌐 بجانب المنفذ 4000.
MD
