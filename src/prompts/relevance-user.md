CANDIDATE RESUME
================
{{ $('Fetch Master Resume').first().json.data }}

CANDIDATE PREFERENCES
=====================
Desired roles: {{ $('Config').first().json.desiredRoles }}
Must have: {{ $('Config').first().json.mustHaves }}
Deal-breakers: {{ $('Config').first().json.dealBreakers }}
Minimum base salary: {{ $('Config').first().json.minSalary }}
Location / arrangement: {{ $('Config').first().json.candidateLocation }}

JOB POSTING
===========
Title: {{ $json.title }}
Company: {{ $json.company }}
Location: {{ $json.location }}
Workplace: {{ $json.workplaceType }}
Employment type: {{ $json.employmentType }}
Seniority: {{ $json.seniority }}
Salary: {{ $json.salary }}
Posted: {{ $json.postedAt }}

Description:
{{ $json.description }}
