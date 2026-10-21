// Writes a small, real DOCX that holds the standard EICAR antivirus test string, for trying the malware scan by hand.
//
//   node --no-warnings scripts/eicar-docx.ts "<where to write it>.docx"
//
// The browser reads the first bytes of every file and the ZIP's file list, so the bare EICAR text renamed to .pdf is no longer
// added (it is not a real PDF, D-F1-44). Inside a DOCX it is a real file of an allowed type, and the scanner finds the EICAR
// entry when it opens the ZIP and refuses the file. The string is harmless: every scanner flags it on purpose.
import { writeFileSync } from 'node:fs';
import JSZip from 'jszip';

const out = process.argv[2];
if (!out) throw new Error('usage: node --no-warnings scripts/eicar-docx.ts "<file>.docx"');

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const zip = new JSZip();
zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Antivirus test file</w:t></w:r></w:p></w:body></w:document>');
zip.file('eicar.com', EICAR);
writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`Wrote ${out}`);
