# Local Acceptance Helpers

These helpers exercise the disposable lab identity. They are maintainer tools,
not product runtime and not CI.

Required local commands:

~~~text
ssh
sshpass
expect
python3
~~~

Required environment:

~~~text
VEGA0_ADMIN_USER
VEGA0_ADMIN_PASSWORD
VEGA0_USER_PASSWORD
VEGA0_USER_KEY
VEGA0_TOTP_SEED_FILE
VEGA0_KNOWN_HOSTS
~~~

Optional overrides:

~~~text
VEGA0_LOGIN_HOST   default 192.168.1.200
VEGA0_WORKER_HOST  default 192.168.1.162
~~~

Run:

~~~bash
./maintainer/test-targets/vega0/acceptance/run-user-test cpu
./maintainer/test-targets/vega0/acceptance/run-user-test dev
./maintainer/test-targets/vega0/acceptance/run-user-test cgroup
./maintainer/test-targets/vega0/acceptance/run-user-test mpi
~~~

The wrapper:

- refuses to start if either Pi is at or above 75 C;
- waits for a new TOTP interval to avoid replay rejection;
- submits the current password plus six-digit TOTP to the IPA PAM prompt;
- aborts if SSH asks for the factor more than once.

The verified known-hosts file must contain independently verified entries for
both administration IPs. Its login-node line must also be usable through the
vega0-lab HostKeyAlias used by the test-user connection.

Before MPI mode, copy mpi_hello.c to
/ceph/hpc/project/demo-users/mpi_hello.c with test-user ownership.

Never commit the values consumed by these helpers.
