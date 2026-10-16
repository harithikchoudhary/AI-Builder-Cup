"""Generate fictional source packets for the underwriting inbox (requires reportlab)."""
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf"
MANIFEST = ROOT / "samples" / "underwriting" / "applications.json"
PACKETS = [
    {"application_id": "HI-SAMPLE-1001", "applicant": "Priya Mehta", "date_of_birth": "1991-04-18",
     "product_code": "IH-ESSENTIAL", "product_name": "Intentra Health Essential",
     "application_details": {"sum_insured_inr": 500000, "declaration_summary": "Applicant declares no ongoing conditions, no regular medication, and no prior hospital admission. Supporting medical summary received."}},
    {"application_id": "HI-SAMPLE-1002", "applicant": "Arjun Rao", "date_of_birth": "1985-09-12",
     "product_code": "IH-ESSENTIAL", "product_name": "Intentra Health Essential",
     "application_details": {"sum_insured_inr": 1000000, "declaration_summary": "Applicant declares an ongoing condition and regular prescribed medication. Supporting medical report has not been received."}},
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="PacketTitle", fontName="Helvetica-Bold", fontSize=21, leading=26, textColor=colors.HexColor("#23344d"), spaceAfter=12))
    styles.add(ParagraphStyle(name="PacketSection", fontName="Helvetica-Bold", fontSize=12, leading=17, textColor=colors.HexColor("#6950a5"), spaceBefore=16, spaceAfter=8))
    styles.add(ParagraphStyle(name="PacketText", fontName="Helvetica", fontSize=10, leading=16, alignment=TA_LEFT, spaceAfter=7))
    for packet in PACKETS:
        filename = f"{packet['application_id'].lower()}-application.pdf"
        path = OUT / filename
        story = [Paragraph("INTENTRA | APPLICATION INTAKE", styles["PacketSection"]), Paragraph("Health insurance proposal", styles["PacketTitle"]), Paragraph("Fictional sample application. All applicant details and declarations were authored for this prototype; this is not a real identity record or clinical certificate.", styles["PacketText"])]
        fields = [("Application reference", packet["application_id"]), ("Applicant name", packet["applicant"]), ("Date of birth", packet["date_of_birth"]), ("Product", packet["product_name"]), ("Product code", packet["product_code"]), ("Sum insured requested", f"INR {packet['application_details']['sum_insured_inr']:,}"), ("Policy period requested", "12 months")]
        rows = [[Paragraph(label, styles["PacketText"]), Paragraph(value, styles["PacketText"])] for label, value in fields]
        table = Table(rows, colWidths=[160, 320], hAlign="LEFT")
        table.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f6f3fa")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("LINEBELOW", (0, 0), (-1, -1), .4, colors.HexColor("#e5e8ef"))]))
        story += [Spacer(1, 12), table, Paragraph("Health declaration", styles["PacketSection"]), Paragraph(packet["application_details"]["declaration_summary"], styles["PacketText"]), Paragraph("Tobacco use: applicant declares no tobacco use. The employee must compare the declaration and extracted fields with this source before relying on them.", styles["PacketText"]), Paragraph("Identity and processing reference", styles["PacketSection"]), Paragraph(f"Fictional identity reference: FICTIONAL-{packet['application_id']}. Applicant name and date of birth match the proposal above. No government identity document is represented by this reference.", styles["PacketText"]), Paragraph("Sample processing authorization: this fictional packet is provided for Document AI extraction, Vertex AI structuring, and storage in the Intentra prototype.", styles["PacketText"]), Paragraph("Supporting medical information", styles["PacketSection"])]
        story.append(Paragraph("Supporting summary supplied: no ongoing condition, medication, or prior hospital admission is declared. This statement is fictional source evidence and is not medical advice or a validated risk assessment." if packet["application_id"].endswith("1001") else "Supporting medical report: pending. Request the missing report before completing document verification.", styles["PacketText"]))
        def footer(canvas, document):
            canvas.setFont("Helvetica", 8)
            canvas.setFillColor(colors.HexColor("#8793a2"))
            canvas.drawString(52, 34, f"{packet['application_id']} | Fictional source packet")
            canvas.drawRightString(A4[0] - 52, 34, f"Page {document.page}")
        SimpleDocTemplate(str(path), pagesize=A4, leftMargin=52, rightMargin=52, topMargin=38, bottomMargin=52).build(story, onFirstPage=footer, onLaterPages=footer)
        packet["documents"] = [{"name": filename, "file": f"../../output/pdf/{filename}"}]
        if packet["application_id"].endswith("1002"):
            packet["documents"].append({"name": "Supporting medical report", "file": None})
        print(path)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(PACKETS, indent=2), encoding="utf-8")
    print(MANIFEST)


if __name__ == "__main__":
    main()
