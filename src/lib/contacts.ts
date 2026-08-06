/**
 * Acesso aos contatos do celular para a busca de amigos por telefone.
 * Mesmo formato de permissão de src/lib/notifications.ts: só pede de novo se
 * ainda não foi concedida.
 */

import * as Contacts from 'expo-contacts';

export async function requestContactsPermission(): Promise<boolean> {
  const settings = await Contacts.getPermissionsAsync();
  if (settings.granted) return true;
  const request = await Contacts.requestPermissionsAsync();
  return request.granted;
}

/** Todos os números de telefone da agenda, sem duplicatas, ainda no formato bruto do contato. */
export async function readDeviceContactPhoneNumbers(): Promise<string[]> {
  const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
  const numbers = new Set<string>();
  for (const contact of data) {
    for (const phone of contact.phoneNumbers ?? []) {
      if (phone.number) numbers.add(phone.number);
    }
  }
  return Array.from(numbers);
}
