# Engineering Knowledge Base

Curated, **general** engineering reference material used by the IFL
Engineering AI Assistant for retrieval (RAG). It is indexed automatically
when the app starts serving chat — add, edit or delete a `.md` file here
and it is re-indexed on the next request (within ~30 seconds).

## Rules for content in this folder

- Original, general-knowledge explanations only.
- **Do not** paste text from copyrighted standards (ASME, API, ISO, IEC,
  ASTM, etc.) or proprietary/client documents. Refer to standards by name
  only, in general terms.
- Do not state project-specific values as if they were universal. Where a
  value depends on the governing code or project specification, say so.
- One topic per file. Start with frontmatter giving the display title,
  which becomes the citation label, e.g.
  `Engineering Knowledge — QA/QC — Inspection and Test Plan (ITP)`:

  ```
  ---
  title: Inspection and Test Plan (ITP)
  ---
  ```

- Use `##` headings — each heading becomes the "section" of the chunks
  beneath it.

## Folders

| Folder | Scope |
|---|---|
| engineering-fundamentals | Pressure/temperature terminology, units |
| mechanical | Rotating & static equipment |
| piping | Piping classes, ratings, components |
| process | PFD/P&ID, process safety studies |
| electrical | Motors, hazardous areas |
| instrumentation | Tagging, signals, datasheets |
| qaqc | ITP, welding qualification, NDT |
| project-engineering | Deliverables, revisions, change control |
| procurement | MTO, requisitions, bid evaluation |
| terminology | Glossary of abbreviations |
| calculations | Common first-principles calculations |
