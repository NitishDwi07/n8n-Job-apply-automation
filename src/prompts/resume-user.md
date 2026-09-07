MASTER RESUME - the only source of truth, do not exceed it
==========================================================
{{ $('Fetch Master Resume').first().json.data }}

CONTACT LINE - use verbatim
===========================
{{ $('Config').first().json.candidateName }} | {{ $('Config').first().json.candidateEmail }} | {{ $('Config').first().json.candidatePhone }} | {{ $('Config').first().json.candidateLinkedIn }} | {{ $('Config').first().json.candidateLocation }}

TARGET POSTING
==============
Title: {{ $json.title }}
Company: {{ $json.company }}
Location: {{ $json.location }} ({{ $json.workplaceType }})
Seniority: {{ $json.seniority }}

Screening notes for this posting:
- Match score: {{ $json.score }}
- Why it matched: {{ $json.matchReasons }}
- Gaps to de-emphasise (never fabricate cover for them): {{ $json.gaps }}
- Suggested angle: {{ $json.suggestedResumeAngle }}

Full posting text:
{{ $json.description }}

Write the tailored resume now. Output HTML only.
