# Part 1: AWS infrastructure

Infrastructure is provisioned by [template.yaml](../template.yaml), using [the automated deployment guide](DEPLOYMENT.md). The previous manual-console recipe is superseded by the template.

| Resource | Implemented configuration |
| --- | --- |
| PDF bucket | Private, TLS-only, encrypted, versioned; generated from project/account/region |
| Documents table | Document primary key and owner/creation index; states, extraction job/version, progress counters |
| Chunks table | Document partition and chunk sort key; text/pages/vectors; filtered insertion stream |
| Answer jobs table | Owner-scoped status/result records with 24-hour TTL |
| Textract/SNS | Dedicated notification role, scoped publish permission, account/source trust, and PassRole |
| Lambda roles | Per-function permissions for required tables, object prefix, model/profile, or queue |
| API Gateway | Regional REST API; AWS IAM authentication; same-account resource policy; throttling |
| Queues/logs | Answer work queue, failure queues, queue alarms, 14-day Lambda logs |

Default deployment is `us-east-1` with Nova 2 Lite's US inference profile. Direct Titan V2 and Nova 2 Lite calls succeeded from AWS CloudShell in that region on 27 November 2026, but application-role permissions, runtime quotas, and the full stack have not been verified. An authorized deployment identity is still required. The template does not configure a billing budget or external alarm notification destination. PDFs and document/chunk tables are retained on stack deletion.
