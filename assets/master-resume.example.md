# Master resume — the shape to aim for

Put this in a Google Doc (plain text is fine — no formatting survives the
export, and none is needed) and paste its ID into `Config.masterResumeDocId`.

Two rules:

1. **Be exhaustive.** Every role, every project, every tool, every number. This
   document is the closed world the AI is allowed to draw from — the prompt
   forbids inventing anything outside it. If a skill is not in here, it will
   never appear on a tailored resume, no matter how well it matches a posting.
   Three or four pages is fine. This is a database, not a resume.
2. **Keep your metrics.** The prompt tells the writer to preserve whatever
   number a bullet gives it. Bullets without numbers come out weaker.

---

```
ADA LOVELACE
ada@example.com | +1 555 0100 | linkedin.com/in/adalovelace | Berlin, Germany
Open to remote within the EU. Not open to relocation.

SUMMARY
Backend and platform engineer, 8 years. Built and owned data platforms at two
Series B startups and one scale-up. Strongest in Python, Go, AWS, and the
operational side of data infrastructure.

SKILLS
Languages:      Python (8 yrs), Go (3 yrs), SQL (8 yrs), Bash, TypeScript (2 yrs)
Data:           Airflow, dbt, Kafka, Spark, Snowflake, Postgres, ClickHouse
Infrastructure: AWS (ECS, Lambda, RDS, S3, IAM), Terraform, Docker, GitHub Actions
Observability:  Datadog, Prometheus, Grafana, OpenTelemetry
Practices:      Code review, on-call rotation lead, incident response, RFC authoring

EXPERIENCE

Senior Data Engineer — Globex GmbH, Berlin
Mar 2021 – present
- Owned the company's batch data platform end to end: 340 Airflow DAGs, 2.1 TB
  processed daily, 99.95% on-time delivery over the last 18 months.
- Cut warehouse spend 41% ($380k/yr) by re-partitioning the six largest tables
  and moving cold aggregates to ClickHouse.
- Migrated 90 legacy cron jobs to Airflow over two quarters with no data loss
  and no downtime window.
- Led the on-call rotation for the data org (7 engineers); brought mean time to
  recovery from 4.2 h to 48 min by adding runbooks and DAG-level SLAs.
- Mentored three junior engineers; two were promoted within 18 months.

Backend Engineer — Acme Analytics, Remote
Jun 2018 – Feb 2021
- Built the ingestion service handling 1.2 B events/day in Go, p99 under 40 ms.
- Designed the multi-tenant Postgres schema still serving 400+ customers.
- Introduced Terraform; brought environment provisioning from ~3 days to 20 min.
- Wrote the incident review process the engineering org still uses.

Software Engineer — Initech, London
Aug 2017 – May 2018
- Shipped the customer-facing reporting API in Python/Flask, 60+ endpoints.
- Raised test coverage on the billing module from 12% to 84%.

EDUCATION
BSc Computer Science — University of Manchester, 2017. First class honours.

CERTIFICATIONS
AWS Certified Solutions Architect – Associate (2022, renewed 2025)
Certified Kubernetes Application Developer (CKAD, 2023)

PROJECTS
dbt-lineage-lint — open source dbt linter, 1.2k GitHub stars, ~40k downloads/mo.
Conference talk, PyData Berlin 2024: "Airflow at 300 DAGs".

LANGUAGES
English (native), German (B2), French (A2)
```
