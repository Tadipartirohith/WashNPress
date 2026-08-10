# Review checklist

Use this list when reviewing the pull request.

Correctness of money and custody. Confirm that every movement of money is a balanced
ledger transaction, that slot booking reserves capacity atomically before creating an
order, that the payment webhook verifies the signature and ignores duplicates, and that
reconciliation credits a paid top up exactly once.

Configuration. Confirm that no secret or environment value is hard coded, that every new
setting is present in config default and in the schema, and that each is described in the
configuration document.

Security. Confirm that authentication endpoints are rate limited, that route access is
gated by role, that there is no implicit development backdoor, and that no secret is
committed to the repository.

Background jobs. Confirm that the job runner starts on boot, that intervals come from the
config, and that each job handles its own errors without stopping the others.

Tests. Confirm that the unit and functional tests pass, that the continuous integration
workflow builds the Docker image and runs the container smoke test, and that the coverage
covers the domain and service layers.

Documentation. Confirm that the documents use plain keyboard characters and complete
sentences, and that the run instructions match the current behaviour.
