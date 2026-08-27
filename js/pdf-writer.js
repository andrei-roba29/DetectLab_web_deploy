/* ─────────────────────────────────────────────────────────────────────────────
 * DetectLab — minimal, dependency-free PDF writer
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A HAND-ROLLEN WRITER (and not jsPDF / pdfmake / a server call)
 * ──  The Archeological Report has to work:
 *       • offline, inside the installed PWA (no new CDN dependency, no new
 *         entry in the service-worker runtime cache strategy);
 *       • with perfect Romanian typography (ă, ș, ț, â, î);
 *       • with rich layout (colored score bars, star ratings, tables, map
 *         screenshots) that would be painful to express in a text-flow API.
 *
 *     The PDF "standard 14" fonts only ship WinAnsi/Latin-1 encodings, which do
 *     NOT contain ă/ș/ț — so any text-based PDF would either need an embedded
 *     TrueType subset (tens of kB of base64 in the repo + a font parser) or
 *     would have to transliterate the Romanian report into "potential
 *     arheologic"-style ASCII. Neither is acceptable.
 *
 *     So the report pages are composed on a <canvas> (full control over fonts,
 *     diacritics, colors and the embedded screenshots) and each page is stored
 *     as one JPEG image inside a real PDF file. The result is a normal,
 *     downloadable, printable PDF that opens in every reader; its only
 *     trade-off is that the page text is not selectable.
 *
 * WHAT THIS FILE DOES
 * ──  Emits a valid PDF 1.4 file:
 *       obj 1  Catalog      → /Pages
 *       obj 2  Pages        → /Kids [page objects]
 *       obj 3  Info         → Title / Author / Subject / Producer / CreationDate
 *       obj 4+ per page:  Page  →  Contents stream  →  Image XObject (DCTDecode)
 *     plus a correct cross-reference table, so readers never need to repair it.
 *
 * USAGE
 *     var pdf = new DetectLabPdf({ title: 'Raport arheologic', size: 'a4' });
 *     pdf.addImagePage(canvas.toDataURL('image/jpeg', 0.85));   // or Uint8Array
 *     pdf.save('raport.pdf');            // triggers a browser download
 *     var blob = pdf.toBlob();           // …or keep it in memory
 *
 * TESTS
 *     node test-archeo-report.js exercises build() and validates the produced
 *     byte stream (header, object count, xref offsets, trailer).
 * ───────────────────────────────────────────────────────────────────────────── */
(function (root) {
    'use strict';

    var PAGE_SIZES = {
        a4: [595.276, 841.890],   // 210 × 297 mm
        letter: [612, 792],       // 8.5 × 11 in
        a4l: [841.890, 595.276]   // A4 landscape
    };

    // Structural PDF strings are pure ASCII; anything non-ASCII is escaped.
    function latin1Bytes(str) {
        var out = new Uint8Array(str.length);
        for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
        return out;
    }

    // WinAnsi has no ă/ș/ț (with or without comma/cedilla). Metadata is the only
    // place where plain text ends up in the file, so it is transliterated there.
    // Characters with no WinAnsiEncoding code point, mapped to the closest
    // ASCII/Latin-1 equivalent (â, î, ², °, · … all exist in Latin-1 as-is).
    var WINANSI_FALLBACKS = {
        '\u2014': '-', '\u2015': '-', '\u2013': '-', '\u2212': '-',  // dashes
        '\u2018': "'", '\u2019': "'", '\u201A': ',', '\u2039': '<', '\u203A': '>',
        '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u00AB': '"', '\u00BB': '"',
        '\u2026': '...', '\u2022': '-', '\u00B7': '\u00B7',
        '\u2265': '>=', '\u2264': '<=', '\u2248': '~', '\u00B1': '+/-',
        '\u2192': '->', '\u2190': '<-', '\u2194': '<->', '\u00D7': 'x', '\u00F7': '/',
        '\u00A0': ' ', '\u2007': ' ', '\u202F': ' ', '\uFEFF': '', '\u200B': '',
        '\u25A0': '-', '\u25AA': '-', '\u2B22': '-', '\u25B2': '^', '\u25CF': '-'
    };

    function winAnsiSafe(str) {
        return String(str == null ? '' : str)
            .replace(/[\u0103]/g, 'a').replace(/[\u0102]/g, 'A')
            .replace(/[\u0219\u015F]/g, 's').replace(/[\u0218\u015E]/g, 'S')
            .replace(/[\u021B\u0163]/g, 't').replace(/[\u021A\u0162]/g, 'T')
            .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, function (c) {
                return Object.prototype.hasOwnProperty.call(WINANSI_FALLBACKS, c) ? WINANSI_FALLBACKS[c] : '?';
            });
    }

    function escapePdfString(str) {
        return winAnsiSafe(str)
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)')
            .replace(/[\r\n\t]/g, ' ');
    }

    function base64ToBytes(b64) {
        var bin = root.atob(b64);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function pdfDate(d) {
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return 'D:' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
            p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
    }

    /**
     * @param {Object} options
     *   size    'a4' (default) | 'letter' | 'a4l'
     *   title / author / subject / keywords  — document metadata
     *   date    Date for CreationDate (default: now)
     */
    function PdfDocument(options) {
        options = options || {};
        this.pageSize = PAGE_SIZES[String(options.size || 'a4').toLowerCase()] || PAGE_SIZES.a4;
        this.metadata = {
            Title: options.title || 'DetectLab Report',
            Author: options.author || 'DetectLab',
            Subject: options.subject || '',
            Keywords: options.keywords || 'DetectLab, archaeology, APM',
            Producer: 'DetectLab — js/pdf-writer.js',
            Creator: 'DetectLab'
        };
        this.date = options.date instanceof Date ? options.date : new Date();
        this.pages = []; // [{ bytes: Uint8Array, pxWidth, pxHeight }]
    }

    /**
     * Add one full page from a JPEG.
     * @param {Uint8Array|ArrayBuffer|string} source  JPEG bytes or a
     *        `data:image/jpeg;base64,…` data URL (canvas.toDataURL output).
     * @param {number} pxWidth   pixel width  (needed for byte input)
     * @param {number} pxHeight  pixel height
     */
    PdfDocument.prototype.addImagePage = function (source, pxWidth, pxHeight) {
        var bytes = source;
        if (typeof source === 'string') {
            var m = /^data:image\/jpe?g;base64,([\s\S]+)$/i.exec(source);
            if (!m) throw new Error('PdfDocument.addImagePage: expected JPEG bytes or a JPEG data URL');
            bytes = base64ToBytes(m[1]);
        } else if (source instanceof ArrayBuffer) {
            bytes = new Uint8Array(source);
        }
        if (!bytes || !bytes.length) throw new Error('PdfDocument.addImagePage: empty image');
        if (!pxWidth || !pxHeight) throw new Error('PdfDocument.addImagePage: pixel size required');
        this.pages.push({ bytes: bytes, pxWidth: pxWidth, pxHeight: pxHeight });
        return this;
    };

    /** Serialise to a Uint8Array containing the whole .pdf file. */
    PdfDocument.prototype.build = function () {
        if (!this.pages.length) throw new Error('PdfDocument.build: no pages');

        var chunks = [];
        var offset = 0;
        function w(str) { var b = latin1Bytes(str); chunks.push(b); offset += b.length; }
        function wb(bytes) { chunks.push(bytes); offset += bytes.length; }

        var offsets = [];                       // object number -> byte offset
        function beginObj(n) { offsets[n] = offset; w(n + ' 0 obj\n'); }
        function endObj() { w('endobj\n'); }

        var pageCount = this.pages.length;
        // 1 = Catalog, 2 = Pages, 3 = Info, then 3 objects per page.
        var objCount = 3 + pageCount * 3;

        w('%PDF-1.4\n');
        // Binary marker comment: tells readers the file contains binary data.
        wb(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

        beginObj(1);
        w('<< /Type /Catalog /Pages 2 0 R >>\n');
        endObj();

        var kids = [];
        for (var p = 0; p < pageCount; p++) kids.push((4 + p * 3) + ' 0 R');
        beginObj(2);
        w('<< /Type /Pages /Count ' + pageCount + ' /Kids [' + kids.join(' ') + '] >>\n');
        endObj();

        beginObj(3);
        w('<< /Title (' + escapePdfString(this.metadata.Title) + ')' +
          ' /Author (' + escapePdfString(this.metadata.Author) + ')' +
          ' /Subject (' + escapePdfString(this.metadata.Subject) + ')' +
          ' /Keywords (' + escapePdfString(this.metadata.Keywords) + ')' +
          ' /Producer (' + escapePdfString(this.metadata.Producer) + ')' +
          ' /Creator (' + escapePdfString(this.metadata.Creator) + ')' +
          ' /CreationDate (' + pdfDate(this.date) + ') >>\n');
        endObj();

        var pageW = this.pageSize[0], pageH = this.pageSize[1];

        for (var i = 0; i < pageCount; i++) {
            var page = this.pages[i];
            var pageObj = 4 + i * 3, contentObj = 5 + i * 3, imageObj = 6 + i * 3;

            beginObj(pageObj);
            w('<< /Type /Page /Parent 2 0 R' +
              ' /MediaBox [0 0 ' + pageW.toFixed(3) + ' ' + pageH.toFixed(3) + ']' +
              ' /Resources << /XObject << /Im0 ' + imageObj + ' 0 R >> >>' +
              ' /Contents ' + contentObj + ' 0 R >>\n');
            endObj();

            // One image, stretched over the full page (the page canvases are
            // rendered at the same aspect ratio, so nothing gets distorted).
            var content = 'q\n' + pageW.toFixed(3) + ' 0 0 ' + pageH.toFixed(3) + ' 0 0 cm\n/Im0 Do\nQ\n';
            beginObj(contentObj);
            w('<< /Length ' + content.length + ' >>\nstream\n');
            w(content);
            w('endstream\n');
            endObj();

            beginObj(imageObj);
            w('<< /Type /XObject /Subtype /Image /Width ' + page.pxWidth +
              ' /Height ' + page.pxHeight +
              ' /ColorSpace /DeviceRGB /BitsPerComponent 8' +
              ' /Filter /DCTDecode /Length ' + page.bytes.length + ' >>\nstream\n');
            wb(page.bytes);
            w('\nendstream\n');
            endObj();
        }

        var xrefOffset = offset;
        w('xref\n0 ' + (objCount + 1) + '\n');
        w('0000000000 65535 f \n');
        for (var n = 1; n <= objCount; n++) {
            var off = offsets[n];
            if (off === undefined) throw new Error('PdfDocument.build: missing object ' + n);
            var s = String(off);
            while (s.length < 10) s = '0' + s;
            w(s + ' 00000 n \n');
        }
        w('trailer\n<< /Size ' + (objCount + 1) + ' /Root 1 0 R /Info 3 0 R >>\n' +
          'startxref\n' + xrefOffset + '\n%%EOF\n');

        var total = 0;
        for (var c = 0; c < chunks.length; c++) total += chunks[c].length;
        var out = new Uint8Array(total);
        var pos = 0;
        for (var k = 0; k < chunks.length; k++) {
            out.set(chunks[k], pos);
            pos += chunks[k].length;
        }
        return out;
    };

    PdfDocument.prototype.toArrayBuffer = function () {
        var u8 = this.build();
        // Copy so the ArrayBuffer is exactly the PDF (no slack from the view).
        return u8.slice(0).buffer;
    };

    PdfDocument.prototype.toBlob = function () {
        return new Blob([this.build()], { type: 'application/pdf' });
    };

    /** Trigger a browser download of the finished file. */
    PdfDocument.prototype.save = function (filename) {
        var blob = this.toBlob();
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename || 'detectlab-report.pdf';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 4000);
        return filename;
    };

    root.DetectLabPdf = PdfDocument;
    root.DetectLabPdf.PAGE_SIZES = PAGE_SIZES;
    // Exported for tests / debugging.
    root.DetectLabPdf._internals = {
        latin1Bytes: latin1Bytes,
        escapePdfString: escapePdfString,
        winAnsiSafe: winAnsiSafe,
        base64ToBytes: base64ToBytes,
        pdfDate: pdfDate
    };
})(typeof window !== 'undefined' ? window : globalThis);
