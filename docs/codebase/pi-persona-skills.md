# Persona & Skills

> Behavior configuration and skill instructions

## 🌱 Why Persona & Skills Exist

Persona and skills shape how Pi behaves when interacting with nixPI. They provide:

- **Persona**: Identity, personality traits, and behavioral boundaries
- **Skills**: Written instructions for procedures, guidance, and checklists

Together they form the "software" that runs on the "hardware" of extensions.

## 🚀 What They Own

| Component | Purpose | Location |
|-----------|---------|----------|
| Persona files | Identity and behavior | `core/pi/persona/` |
| Skill files | Instructions and procedures | `core/pi/skills/` |

## 📋 Persona Files

Persona files live in `core/pi/persona/` and are loaded into Pi context.

### File Structure

```
core/pi/persona/
├── body.md      # Physical embodiment and capabilities
├── faculty.md   # Cognitive capabilities and reasoning
└── soul.md      # Values, personality, behavioral boundaries
```

### File Purposes

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `body.md` | Physical capabilities | Hardware embodiment, sensorimotor bounds | Describes nixPI host capabilities |
| `faculty.md` | Cognitive capabilities | Reasoning modes, knowledge domains | Mental capabilities and limits |
| `soul.md` | Values and personality | Ethical bounds, preferences, tone | Behavioral guardrails |

### Persona Inheritance

Persona files are injected into Pi context at session start. They:
- Shape response style and tone
- Define what Pi knows about its embodiment
- Set behavioral boundaries (what Pi will/won't do)

---

## 📋 Skills

Skills are markdown instruction files in `core/pi/skills/`.

### Skill Structure

```
core/pi/skills/
├── SKILL.md          # Main skill manifest
├── <area>/
│   └── SKILL.md      # Domain-specific skills
└── ...
```

### What Skills Contain

Skills are **not** code. They contain:

- **Procedures**: Step-by-step instructions for tasks
- **Guidance**: How to approach common situations
- **Checklists**: Verification steps
- **Reference**: Information Pi should know

### Skill Format (SKILL.md)

```markdown
# Skill Name

## Description

What this skill covers and when to use it.

## Procedures

### Procedure Name

1. Step one
2. Step two
3. Step three

## Checklist

- [ ] Verify X
- [ ] Confirm Y
- [ ] Complete Z

## Reference

Information to reference when using this skill.
```

### Registration

Skills are registered in `package.json`:

```json
{
  "pi": {
    "skills": ["./core/pi/skills"]
  }
}
```

---

## 🔍 How Persona & Skills Work Together

### Runtime Flow

```
Session Start
    ↓
Load Persona Files (body, faculty, soul)
    ↓
Load Relevant Skills (based on context)
    ↓
Execute with Persona + Skills + Tools
```

### Interaction with Extensions

| Component | Type | Purpose |
|-----------|------|---------|
| Persona | Behavior | Who Pi is |
| Skills | Instructions | What Pi knows how to do |
| Extensions | Code | What Pi can actually execute |

**Example Flow**:
1. User asks Pi to update NixOS
2. **Skills**: Provide procedure for safe updates
3. **Persona**: Determine cautious/conservative approach
4. **Extensions**: Execute actual `nixos-rebuild` commands

---

## 🔄 Relationship to Code

### Separation of Concerns

| Aspect | Persona/Skills | Extensions |
|--------|----------------|------------|
| What | Behavioral guidance | Executable tools |
| How | Written instructions | TypeScript code |
| Updates | Markdown edits | Code changes + tests |
| Runtime | Loaded into context | Registered as tools |

### When to Use Each

**Use Persona when**:
- Defining behavioral boundaries
- Setting response tone/style
- Describing capabilities

**Use Skills when**:
- Documenting procedures
- Providing reference information
- Creating checklists

**Use Extensions when**:
- Executing system commands
- Reading/writing files
- Integrating with external services

---

## 📝 Maintenance Guidelines

### Persona Maintenance

- Keep descriptions grounded in actual capabilities
- Update when new hardware/software capabilities added
- Review behavioral boundaries periodically

### Skill Maintenance

- Keep procedures up to date with actual extension behavior
- Verify checklists match current best practices
- Add new skills when new domains are introduced
- Skills should reference extension tools, not duplicate them

---

## 🔗 Related

- [Pi Extensions](./pi-extensions) - Code tools that complement skills
- [Core Library](./core-lib) - Shared utilities
