# Reference File Deployment Map

Review every file before installation. Paths are relative to this directory.

| Source | Target | Nodes | Owner/mode |
| --- | --- | --- | --- |
| config/netplan/60-hpc-eth0.login.yaml | /etc/netplan/60-hpc-eth0.yaml | Login | root:root 0600 |
| config/netplan/60-hpc-eth0.worker.yaml | /etc/netplan/60-hpc-eth0.yaml | Worker | root:root 0600 |
| config/hosts/login | /etc/hosts | Login | root:root 0644 |
| config/hosts/worker | /etc/hosts | Worker | root:root 0644 |
| config/slurm/slurm.conf | /etc/slurm/slurm.conf | Both | root:root 0644 |
| config/slurm/cgroup.conf | /etc/slurm/cgroup.conf | Both | root:root 0644 |
| config/slurm/slurmdbd.conf.example | /etc/slurm/slurmdbd.conf | Login | slurm:slurm 0600, replace password |
| config/mariadb/60-slurm.cnf | /etc/mysql/mariadb.conf.d/60-slurm.cnf | Login | root:root 0644 |
| config/nfs/exports | /etc/exports | Login | root:root 0644 |
| config/nfs/fstab.worker.fragment | append to /etc/fstab | Worker | root:root 0644 |
| config/nfs/idmapd.conf | /etc/idmapd.conf | Both | root:root 0644 |
| config/ssh/60-ssh-user-vega.conf | /etc/ssh/sshd_config.d/60-ssh-user-vega.conf | Login only | root:root 0644 |
| config/systemd/vega-private-dns.service | /etc/systemd/system/vega-private-dns.service | Both | root:root 0644 |
| config/systemd/container-fido-ipa.service | /etc/systemd/system/container-fido-ipa.service | Login | root:root 0644 |
| config/systemd/vega-thermal-watch.service | /etc/systemd/system/vega-thermal-watch.service | Both | root:root 0644 |
| config/modules/vega-modules.sh | /etc/profile.d/vega-modules.sh | Both | root:root 0644 |
| config/modules/modulefiles/* | /ceph/hpc/software/modulefiles/* | Shared namespace | root:hpc-users 0755/0644 |
| node-scripts/vega-prolog | /usr/local/sbin/vega-prolog | Both | root:root 0755 |
| node-scripts/vega-task-prolog | /usr/local/sbin/vega-task-prolog | Both | root:root 0755 |
| node-scripts/vega-epilog | /usr/local/sbin/vega-epilog | Both | root:root 0755 |
| node-scripts/vega-thermal-guard | /usr/local/sbin/vega-thermal-guard | Both | root:root 0755 |
| node-scripts/vega-thermal-watch | /usr/local/sbin/vega-thermal-watch | Both | root:root 0755 |
| node-scripts/apptainer | /usr/local/bin/apptainer | Both | root:root 0755 |

After systemd file changes:

~~~bash
sudo systemctl daemon-reload
~~~

Before SSH reload:

~~~bash
sudo sshd -t
~~~

Before Slurm restart, compare the slurm.conf and cgroup.conf hashes on both
nodes. They must match.

Never replace /etc/fstab with the fragment file. Append only its NFS line.
