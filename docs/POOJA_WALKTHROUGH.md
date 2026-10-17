# Pooja: application-to-recommendation recording guide

## Prepared application

- Application: `SLH-HI-2026-0147`, Pooja Sharma.
- Product: SecureLife Health Shield Plus, `SLH-HSP-IND-01`.
- Cover: INR 1,000,000; one year; Bengaluru, Karnataka.
- Primary policy: `POL-7CD70A42D7BB`, product rules and health rate grid, version 1.0.1.
- Regulatory reference: `POL-917693BB11E4`, the stored 2024 IRDAI health circular.
- Documents: 14 original documents plus six follow-up case records.
- Earlier underwriting runs remain under **View previous runs**.

The follow-up records and product rates are generated fixtures for the supplied fictional application, not independent identity, insurer, provider or consent authentication. Provenance is stored in PDF metadata and the private follow-up manifest. Main product screens use ordinary underwriting language. The workflow does not automatically record employee confirmations or decisions.

## Recording sequence: 3-4 minutes

Trim passive processing time in the recording; keep review actions and calculated results visible.

1. **0:00-0:30 - The application.** Open Pooja from Applications. Show the INR 10 lakh request, medical declaration and the 20 source documents. The follow-up index links each verification requirement to a source record.
2. **0:30-0:50 - The selected policies.** Show the product policy and regulatory reference. Open the product's **Rate grid & premium calculation rules**. Explain that product rate versions are saved with the run. Start the review.
3. **0:50-1:30 - Document review.** Document AI reads the PDFs; Gemini structures source-supported fields. Compare the key values with the original proposal, medical questionnaire, laboratory report and consultation. Record the employee review and resume.
4. **1:30-2:30 - Medical and policy review.** At the risk checkpoint, open the supporting evidence. Select the medical and tobacco classifications after reviewing the product criteria. For this controlled-condition scenario, the configured class is `CONTROLLED_CONDITION`; tobacco is `NON_SMOKER`. Select the documents actually reviewed and enter a concise assessment. Record verification and rule dispositions with their references and rationale. Use **Use assessment note for selected requirements** only where that same note genuinely applies. Save the assessment and refresh the findings. Review the refreshed result, then record the checkpoint confirmation and continue.
5. **2:30-3:15 - Premium.** Show the selected rate row, multipliers, formula and Gemini explanation. The AI proposal is independently checked against the configured calculator before it is labeled verified.
6. **3:15-4:00 - Decision dashboard.** Show the recommendation, premium, risk triage, applied policy versions, evidence and any open requirements. An employee records the final decision with rationale. Show **View previous runs** or **Regenerate underwriting** briefly if time permits.

## Follow-up references to review

| Requirement | Source record | Reference |
| --- | --- | --- |
| Identity | `15_identity_address_review.pdf` | `IAV-20261018-0147` |
| Address | `15_identity_address_review.pdf` | `ADDR-20261018-0147` |
| Medical record reconciliation | `17_medical_record_confirmation.pdf` | `MEDCONF-20261018-0147` |
| Previous coverage | `18_prior_cover_confirmation.pdf` | `CONT-20261018-0147` |
| Consent acknowledgement | `19_processing_consent_record.pdf` | `CONSENT-20261018-0147` |
| Contact acknowledgement | `16_contact_confirmation.pdf` | `CONTACT-20261018-0147` |

These references assist the employee; their presence does not automatically close a requirement. The earlier documents' pending statements remain intact, with later follow-up evidence recorded separately. The acknowledgement record does not reproduce a handwritten signature or external e-signature-provider proof. Assess its scope against the chosen requirements rather than claiming an independent authentication occurred.

## Rate-grid illustration

For age 31, INR 1,000,000 cover, Karnataka/SOUTH_URBAN, the employee-reviewed controlled-condition class and non-smoker classification:

`10,000 age-and-cover base × 1.05 region × 1.10 medical × 1.00 tobacco = INR 11,550.00 per year before tax`

The rate comes from the selected versioned product JSON, not a hardcoded applicant-specific premium. Age bands 18-60 and cover options INR 500,000 / 1,000,000 / 1,500,000 are configured. Unsupported ages, missing/overlapping rates, unknown classifications or specialist referral do not produce a premium. A declared condition cannot use the no-declared-condition STANDARD class for this product. This is product-based triage, not a predictive medical score.

## How Gemini pricing works

The pricing call receives the case, rating date, declarations, employee-reviewed classifications, full rate grid, multipliers and calculation conditions. Gemini returns its selected base, factors, age, cover, annual amount and explanation. The backend independently checks all numeric fields. A mismatching AI proposal is rejected; the UI explains when the configured calculator was used instead. No tax is invented, and an indicative premium is separate from issuance.

## Preparing again

Generate the follow-up PDFs with `scripts/create_pooja_followups.py` using the bundled document Python runtime. Register the policy with `python -m backend.configure_health_demo`. After deliberately preserving the current run, use `python -m backend.prepare_pooja_case --regenerate-existing` to attach the records and prepare a fresh review. The preparation scripts never sign off employee checks, select medical classifications or record an approval.
