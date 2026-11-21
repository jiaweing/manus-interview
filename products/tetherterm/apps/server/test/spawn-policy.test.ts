// Issue #103's exact verification command; root scripts also run these suites
// independently from their standard unit/integration/e2e directories.
import "./unit/spawn-policy.test";
import "./integration/spawn-policy.test";
import "./e2e/config-startup.test";
