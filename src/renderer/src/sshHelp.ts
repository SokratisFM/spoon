// Failures that come from SSH access to GitHub (no key, a key GitHub doesn't know, github.com not yet
// trusted), and opening the SSH setup from anywhere (the App listens).

/** Whether git's error text is about SSH access, which SSH setup can fix. */
export function sshTrouble(message: string): boolean {
  return /Permission denied \(publickey|Host key verification failed|No .* host key is known for github|Could not read from remote repository/i.test(message)
}

export function requestSshSetup(): void {
  window.dispatchEvent(new CustomEvent('spoon:sshSetup'))
}
