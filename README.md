# Wash N Press

[![Backend CI](https://github.com/Tadipartirohith/WashNPress/actions/workflows/backend-ci.yml/badge.svg)](https://github.com/Tadipartirohith/WashNPress/actions/workflows/backend-ci.yml)
[![Mobile CI](https://github.com/Tadipartirohith/WashNPress/actions/workflows/mobile-ci.yml/badge.svg)](https://github.com/Tadipartirohith/WashNPress/actions/workflows/mobile-ci.yml)

This repository contains the Wash N Press platform. It is a subscription based
community laundry service for residential societies. The platform has a backend
service and a cross platform mobile app.

## Structure

The folder washnpress-v2 is the backend service. It is written in TypeScript and built
on Fastify. It uses a double entry ledger for all money, an explicit order state
machine for the garment lifecycle, atomic slot booking that cannot oversell capacity,
and verified idempotent payment webhooks. It runs with in memory storage by default,
and it runs with PostgreSQL when the storage driver is set to postgres.

The folder washnpress-mobile is the mobile app. It is built with Expo and React Native
and runs on iOS, Android, and the web from one codebase. It has resident screens for
login, plans, booking, and order tracking, and an operator Operations mode with a full
processing pipeline and an offline action queue.

## Getting started

To run the backend, open washnpress-v2 and read its README file. In short, run npm
install and then npm start, and the service listens on port 8080. To run the app, open
washnpress-mobile and read its README file. In short, run npm install and then npm run
web, and point it at the backend.

## Default port

The service listens on port 8080. When running in Docker, the host port is set with the
HOST_PORT environment variable and also defaults to 8080.

## Continuous integration

The workflows in the folder .github/workflows run type checks, tests, a production
build, a Docker image build, and a smoke test on every push and every pull request. On
the main branch the backend image is published to the GitHub Container Registry.

## Testing

The backend has a full unit and functional test suite that runs with npm test. There is
also a Python script at washnpress-v2/scripts/smoke_test.py that tests a running
instance end to end, and a paramiko based script for testing a remote host over SSH.
