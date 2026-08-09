// pg is an optional runtime dependency, only loaded when the storage driver is
// postgres. This ambient declaration keeps type checking clean when pg is not installed.
declare module "pg";
