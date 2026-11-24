# Kept — Privacy Policy

_Last updated: November 24, 2026_

Kept is an Atlassian Forge app for Jira Service Management. It runs entirely on Atlassian's Forge platform ("Runs on Atlassian"). Kept has **no servers of its own** and sends **no data outside your Atlassian site**.

## What Kept reads
- Public replies ("Reply to customer" comments) on Jira Service Management requests, to find promises agents make.
- Issue fields needed to connect a promise to its work: request key and summary, reporter, Organizations, issue links, and the linked engineering issue's status, sprint and fix versions.

## What Kept stores, and where
For each promise, Kept stores a record in **Forge storage**, the key-value store hosted by Atlassian inside your site's Forge environment. The record contains:
- the request key and the sentence the agent wrote (the promise);
- its kind, due date, status, and the reason for each status change;
- the owner's Atlassian **account ID** and display name;
- the customer's display name and organization name;
- the linked engineering issue key.

Promise records stay until the app is uninstalled. When Kept is uninstalled, Atlassian deletes its Forge storage.

## What Kept does not do
- It does not send data to any external service. The app makes no egress calls.
- It does not use a language model to read replies. Promises are found with deterministic rules.
- It does not sell, share or analyse data for any purpose other than showing promises inside your Jira site.

## Who can see the data
Promises are shown only inside your Jira site. Each view checks that the person looking has permission to see the request. The Rovo agent only returns promises on requests the asking user can see.

## Contact
Questions or requests: open an issue at https://github.com/Ikechukwu-attah/kept/issues
