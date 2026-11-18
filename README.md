---
title: AguaVigia CTG
emoji: 💧
colorFrom: blue
colorTo: cyan
sdk: docker
app_port: 7860
pinned: true
---

# AguaVigía CTG — Despliegue Unificado en la Nube

Plataforma ciudadana de monitoreo del acueducto de Cartagena de Indias:
- **Backend:** Java 21 + Spring Boot 3.5 (Spring Security, JWT, TOTP, Arquitectura Limpia)
- **Bases de datos:** MongoDB 7.0 (Replica Set `rs0` + índices `2dsphere`), PostgreSQL (`aguavigia_analitica`), Redis 7
- **Frontend:** React 19 + MapLibre GL + PMTiles
- **Siembra automática:** 211 barrios de Cartagena + 300 cuentas sintéticas + ingesta de boletines de Acuacar
