"""Create case-fixture follow-up records; provenance stays in PDF metadata/manifest.

Run with the bundled document Python runtime (reportlab).
No identity document, government identifier, wet signature or external API result
is reproduced. These are fictional internal case records for the supplied case.
"""
import hashlib
import json
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/pdf/pooja_followups"
RECORDS = [
    ("15_identity_address_review.pdf", "Identity and address review", "SLH-IAV-0147", [
        ("Applicant", "Pooja Sharma"), ("Application", "SLH-HI-2026-0147"),
        ("Recorded date", "18 October 2026"), ("Identity review", "Name and date of birth matched the permitted identity-verification reference."),
        ("Identity reference", "IAV-20261018-0147"),
        ("Address reviewed", "Flat 302, Cedar Grove Residency, 4th Cross, HSR Layout Sector 2, Bengaluru, Karnataka 560102"),
        ("Address result", "Correspondence address matched the case address-verification record."),
        ("Address reference", "ADDR-20261018-0147"),
        ("Scope", "Internal verification reference only; no government ID number or identity-document image is stored in this record.")]),
    ("16_contact_confirmation.pdf", "Contact confirmation record", "SLH-CONTACT-0147", [
        ("Applicant", "Pooja Sharma"), ("Application", "SLH-HI-2026-0147"),
        ("Recorded date", "18 October 2026"), ("Contact reference", "CONTACT-20261018-0147"),
        ("Mobile reference", "Contact number ending 0147; full number withheld from the review copy."),
        ("Email", "pooja.sharma@example.com"), ("Result", "Applicant contact acknowledgement recorded for the contact reference."),
        ("Use", "Contact confirmation for the application review; this document is not an OTP receipt from a telecommunications provider.")]),
    ("17_medical_record_confirmation.pdf", "Medical record confirmation", "SLH-MEDCONF-0147", [
        ("Applicant", "Pooja Sharma"), ("Application", "SLH-HI-2026-0147"),
        ("Recorded date", "18 October 2026"), ("Review reference", "MEDCONF-20261018-0147"),
        ("Laboratory reference", "MCD-TFT-261010-447; report dated 11 October 2026."),
        ("Consultation reference", "LFC-OPD-261008-096; visit dated 08 October 2026."),
        ("Source reconciliation", "Patient name and the submitted laboratory and consultation reference numbers were reconciled in the case record. No report values were amended."),
        ("Recorded laboratory values", "TSH 2.6 mIU/L; Free T4 1.1 ng/dL; Free T3 3.1 pg/mL. Refer to the original report for its reference intervals."),
        ("Clinical record", "Primary hypothyroidism; Levothyroxine 50 mcg once daily; no new symptoms reported; stable on current regimen by history."),
        ("Scope", "Evidence reconciliation only. The employee must assess the original reports and selected product criteria; no diagnosis or independent medical risk score is issued.")]),
    ("18_prior_cover_confirmation.pdf", "Previous coverage review", "SLH-CONT-0147", [
        ("Applicant", "Pooja Sharma"), ("Application", "SLH-HI-2026-0147"),
        ("Recorded date", "18 October 2026"), ("Review reference", "CONT-20261018-0147"),
        ("Prior insurer declared", "Everwell Health Insurance"), ("Prior policy reference", "EWH-IND-2025-08341"),
        ("Coverage period", "01 November 2025 to 31 October 2026"), ("Prior cover", "INR 500,000"),
        ("Declared claims", "0"), ("Result", "Prior-cover references reconciled for employee continuity review."),
        ("Scope", "An internal review record, not an insurance certificate or a grant of portability/continuity benefits. Apply the selected policy conditions.")]),
    ("19_processing_consent_record.pdf", "Application consent record", "SLH-CONSENT-0147", [
        ("Applicant acknowledgement", "Pooja Sharma"), ("Application", "SLH-HI-2026-0147"),
        ("Recorded date", "18 October 2026"), ("Acknowledgement reference", "CONSENT-20261018-0147"),
        ("Authorization recorded", "Application assessment, processing of health declarations and submitted documents, and prior-insurer verification for this application."),
        ("Processing systems", "Document AI for document extraction, Vertex AI for structured analysis, and controlled application storage."),
        ("Acknowledgement type", "Electronic acknowledgement entry in the application consent register; no handwritten signature image is reproduced."),
        ("Employee task", "Review the consent register reference and scope before recording consent evidence as verified.")]),
    ("20_followup_evidence_index.pdf", "Follow-up evidence index", "SLH-EVIDENCE-0147", [
        ("Applicant", "Pooja Sharma"), ("Application", "SLH-HI-2026-0147"),
        ("Recorded date", "18 October 2026"), ("Identity", "15_identity_address_review.pdf; IAV-20261018-0147"),
        ("Address", "15_identity_address_review.pdf; ADDR-20261018-0147"),
        ("Contact", "16_contact_confirmation.pdf; CONTACT-20261018-0147"),
        ("Medical source review", "17_medical_record_confirmation.pdf; MEDCONF-20261018-0147"),
        ("Previous cover", "18_prior_cover_confirmation.pdf; CONT-20261018-0147"),
        ("Consent", "19_processing_consent_record.pdf; CONSENT-20261018-0147"),
        ("Review action", "Open each record alongside the original proposal documents. Record employee dispositions and evidence references; a document being present does not establish that a requirement passed.")]),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="RecordTitle", fontName="Helvetica-Bold", fontSize=23, leading=29, textColor=colors.HexColor("#123d3a"), spaceAfter=10))
    styles.add(ParagraphStyle(name="RecordBody", fontName="Helvetica", fontSize=10, leading=15, textColor=colors.HexColor("#334155")))
    styles.add(ParagraphStyle(name="RecordLabel", fontName="Helvetica-Bold", fontSize=9, leading=14, textColor=colors.HexColor("#0f766e")))
    manifest = {"application_id": "SLH-HI-2026-0147", "generated_fixture": True,
                "independent_authentication_performed": False,
                "provenance": "Fictional follow-up records extending the user-supplied fictional case. No external identity, provider, insurer or consent authentication was performed.", "documents": []}
    for filename, title, reference, rows in RECORDS:
        path = OUT / filename
        doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=42, leftMargin=42, topMargin=45, bottomMargin=45,
                                title=title, author="Intentra case record generator",
                                subject="Fictional case fixture; not independently authenticated; employee review required")
        story = [Paragraph("SECURELIFE / UNDERWRITING CASE RECORD", styles["RecordLabel"]), Spacer(1, 18),
                 Paragraph(escape(title), styles["RecordTitle"]), Paragraph(escape(reference), styles["RecordBody"]), Spacer(1, 22)]
        table = Table([[Paragraph(escape(label), styles["RecordLabel"]), Paragraph(escape(value), styles["RecordBody"])] for label, value in rows], colWidths=[135, 376], hAlign="LEFT")
        table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 10),
                                   ("RIGHTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 10),
                                   ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                                   ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.HexColor("#f0fdfa"), colors.white]),
                                   ("LINEBELOW", (0, 0), (-1, -1), .4, colors.HexColor("#dce8e6"))]))
        story.append(table)
        def footer(canvas, current):
            canvas.setFont("Helvetica", 8); canvas.setFillColor(colors.HexColor("#64748b"))
            canvas.drawString(42, 25, "SLH-HI-2026-0147 | Internal case follow-up | Employee evidence review required")
            canvas.drawRightString(A4[0]-42, 25, str(current.page))
        doc.build(story, onFirstPage=footer, onLaterPages=footer)
        manifest["documents"].append({"name": filename, "file": str(path), "reference": reference,
                                      "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    (OUT / "provenance.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Created {len(RECORDS)} follow-up records in {OUT}")


if __name__ == "__main__":
    main()
