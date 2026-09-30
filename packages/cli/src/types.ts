/**
 * Re-exported from @cloud/schema so renderer modules import types only and
 * stay dependency-free (and therefore trivially testable). The exceptions are
 * pure helpers the schema needs too, such as containerLimitMiB, imported from
 * @cloud/schema directly so there is one definition.
 */
export type { CloudConfig, Group, Network, Proxy } from "@cloud/schema";
