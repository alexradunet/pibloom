# Operations

> Deploy, operate, and maintain nixPI

## 🌱 What's In This Section

This section covers operational procedures for nixPI:

- Installing and deploying nixPI
- First-boot setup procedures
- Testing and validation
- Day-to-day operations

## 📚 Operations Topics

| Topic | Description |
|-------|-------------|
| [Quick Deploy](./quick-deploy) | Build, deploy, and VM testing |
| [First Boot Setup](./first-boot-setup) | Initial setup procedures |
| [Live Testing](./live-testing) | Validation checklists |

## 🚀 Quick Reference

### Common Commands

```bash
# Deploy
just switch          # Apply local config
just update          # Apply remote config
just rollback        # Revert to previous

# VMs
just vm              # Run test VM
just vm-ssh          # SSH into VM
just vm-stop         # Stop VM

# Testing
just check-config    # Validate NixOS config
just check-boot      # VM boot test
```

## 🔗 Related

- [Architecture](../architecture/) - System design
- [Codebase](../codebase/) - Implementation details
- [Reference](../reference/) - Deep technical docs
