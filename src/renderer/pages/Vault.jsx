import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../App';

import { VaultPane } from '../../shared-ui/VaultPane';

export default function Vault() {
  const { bridge } = useApp();
  const [people, setPeople] = useState([]);
  const request = useCallback((input) => bridge.vault.request(input), [bridge]);
  useEffect(() => {
    bridge.apikeys
      .list()
      .then(setPeople)
      .catch(() => {});
  }, [bridge]);
  return <VaultPane request={request} people={people} />;
}
