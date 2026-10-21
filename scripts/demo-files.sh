#!/usr/bin/env bash
# Makes the files for the demo recording (docs/DEMO-SCRIPT.md) in one folder: 12 small PDFs, one PNG, and a test file
# the virus scanner must refuse. The EICAR file is the standard harmless antivirus test string (68 characters).
#   scripts/demo-files.sh [folder]      # default: ~/docbeam-demo-files
set -euo pipefail

DIR="${1:-$HOME/docbeam-demo-files}"
mkdir -p "$DIR"

names=(
  "Protocol amendment 3" "Informed consent form v2" "Investigator brochure" "Site delegation log"
  "Monitoring visit report" "Lab certification" "IRB approval letter" "Pharmacy manual"
  "Training record" "Safety report Q3" "Statistical analysis plan" "Data management plan"
)
i=0
for n in "${names[@]}"; do
  i=$((i + 1))
  # A one-page PDF that shows its own name (so the preview shows something), with a different number in each so no two
  # files are the same. It has no cross-reference table; PDF viewers rebuild it.
  stream="BT /F1 22 Tf 30 100 Td ($n) Tj 0 -30 Td /F1 12 Tf (Demo file $i) Tj ET"
  printf '%%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length %d>>stream\n%s\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' "${#stream}" "$stream" >"$DIR/$n.pdf"
done

# A 1x1 PNG
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82' >"$DIR/Site photo.png"

# The standard EICAR test string, inside a real DOCX (the page no longer adds the bare text named .pdf: it is not a PDF).
# It is not a virus; every scanner refuses it on purpose.
node --no-warnings "$(dirname "$0")/eicar-docx.ts" "$DIR/EICAR test file.docx" >/dev/null

echo "Wrote $(ls "$DIR" | wc -l) files in $DIR"
