const assert = require('node:assert/strict');

// Deliberately incorrect implementation for a public, dependency-free demo.
function total(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

assert.equal(total([{ price: 7, quantity: 3 }]), 21, 'TOTAL_IGNORES_QUANTITY');
