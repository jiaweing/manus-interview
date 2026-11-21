"""Drive scaffold/01-caret.sh (with --no-git) through its interactive addon prompts via a pty.
Answers: Ultracite linter = Biome; editors / agent files / hooks = none; WXT template = React;
skills scope = Project. Full transcript goes to /home/ubuntu/scaffold-transcript.log"""
import pexpect, re, os, sys, time

ENV = {**os.environ, 'PATH': '/home/ubuntu/.bun/bin:' + os.environ['PATH'], 'TERM': 'xterm-256color'}
log = open('/home/ubuntu/scaffold-transcript.log', 'wb')
child = pexpect.spawn('bash', ['-c', 'sed "s/--git/--no-git/" scaffold/01-caret.sh > /tmp/01-caret-nogit.sh && bash /tmp/01-caret-nogit.sh products/caret'],
                      cwd='/home/ubuntu/manus-interview', env=ENV, dimensions=(50, 160), timeout=900)
child.logfile_read = log
ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07')
buf = ''
answered = []

def current_question(text):
    # last prompt block: from last '◆' to end
    i = text.rfind('◆')
    return text[i:] if i >= 0 else ''

while True:
    try:
        child.expect(pexpect.EOF, timeout=7)
        break
    except pexpect.TIMEOUT:
        buf += ANSI.sub('', child.before.decode('utf8', 'ignore')) if child.before else ''
        child.before = b''
        q = current_question(buf[-4000:])
        if not q or q in answered[-1:]:
            continue
        flat = ' '.join(q.split())
        print('Q:', flat[:300], flush=True)
        answered.append(q)
        if 'Which linter' in q:
            child.send('\r')                     # Biome
        elif re.search(r'editor|Editor', q) and 'Which' in q:
            child.send('\r')                     # multiselect: nothing selected -> submit
        elif 'agent' in q.lower() and ('config' in q.lower() or 'file' in q.lower()):
            child.send('\r')
        elif 'hook' in q.lower():
            child.send('\r')
        elif 'template' in q.lower():
            child.send('\r')                     # React is the default/first; verified below in transcript
        elif 'scope' in q.lower():
            child.send('\r')                     # Project (verify in transcript)
        else:
            print('UNHANDLED -> Enter', flush=True)
            child.send('\r')
print('exit', child.exitstatus, child.signalstatus)
open('/home/ubuntu/scaffold-answers.txt', 'w').write('\n\n'.join(' '.join(a.split()) for a in answered))
