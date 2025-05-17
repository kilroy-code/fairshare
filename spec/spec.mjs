await import(`../../@ki1r0y/distributed-security/${typeof(process) === 'undefined' ? 'dist/securitySpec-bundle.mjs' : 'spec/securitySpec.mjs'}`);
import "../../@kilroy-code/rules/spec/spec.mjs";
import "../../@kilroy-code/ui-components/spec/CollectionTransformSpec.mjs";
import "../../@kilroy-code/ui-components/spec/MutableCollectionSpec.mjs";

import "../../@kilroy-code/flexstore/spec/flexstoreSpec.mjs";
import "../../@kilroy-code/flexstore/spec/versionedSpec.mjs";
import "../../@kilroy-code/flexstore/spec/synchronizerSpec.mjs";

// import "../../@kilroy-code/flexstore/spec/junkSpec.mjs";
