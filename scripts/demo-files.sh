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
  # A minimal file that starts with %PDF, with different text in each so no two files are the same.
  printf '%%PDF-1.7\n%% %s %s\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%%%EOF\n' "$n" "$i" >"$DIR/$n.pdf"
done

# A 1x1 PNG
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82' >"$DIR/Site photo.png"

# The standard EICAR test string. It is not a virus; every scanner refuses it on purpose.
printf '%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' >"$DIR/EICAR test file.pdf"

echo "Wrote $(ls "$DIR" | wc -l) files in $DIR"
