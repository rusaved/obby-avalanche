#!/usr/bin/perl
# Эталонная модель баланса игры 1 (perl). По ней посчитаны таблицы 01a; npm run sim:balance — её порт (01 8.5).
# Не код игры: экономика по событиям, без физики. Гейт = стена, мир = гора (5 гор по 12 стен), ступень = перерождение.
# Что заложено: 5 яиц, по одному на гору, с повторной покупкой (500 / 40K / 3M / 300M / 20B);
#  дорожка max(2 * 1.13^(p-1), 5 * 1.1^(p-1)); lateEase: на ступенях 1+ стены 37-60 мягче, у стены 60 — x0.5;
#  стены 1-3 горы 1 = 20 / 40 / 80 (руками, обучение); кроссовки «Беговые» за 30;
#  ходьба (walkTo): путь от текущей точки до пещеры отрезка идёт со скоростью бега и даёт шаги.
# Бот-жадина без рекламы: бежит к гейту, если стата хватает; иначе после каждой лавины собирает
# подарки зоны и копит на дорожке в укрытии перед гейтом; покупает кроссовки, яйца, трейлы и ауры.
# Шаг 1: обратный расчёт ступени 0 — гейт ставится на стат бота в целевую секунду, округляется.
# Шаг 2: прямой прогон ступени 0 по округлённой таблице.
# Шаг 3: ступени 1..9 — множитель гор W(n) подбирается так, чтобы цикл занимал целевые минуты.
# Запуск: perl balance-model.pl [--log] [--md]   (--log — лог по стенам, --md — таблица 60 стен для 01a, раздел 3)
#  SPAM=1 perl balance-model.pl — плюс прогон «Спамера яиц» (01 8.5): лучшее открытое яйцо при любой возможности,
#   кроссовки во вторую очередь; только прямой прогон ступени 0 по готовой таблице, всё остальное считает бот-жадина.
#  ONCE=1 — старое правило «каждое яйцо один раз» (для сравнения).
# Монеты — как в игре: подарок = nice(gift(p)) из таблицы 01a (150, 300, 600, 1.2K …), за проход стены — 2 × подарок,
#  «Уф, успел!» — 3 × подарок, сундук вершины — 25 × подарок зоны 6 горы (01a, разделы 1 и 4).
# Результат прогона 03.10.2026 (perl 5.42): ступень 0 — 29.3 мин (горы 4.7 / 6.2 / 6.2 / 6.0 / 6.2);
#  wallScale ступеней 1-9 — 15 / 50 / 250 / 1.5K / 6K / 20K / 80K / 300K / 1M; циклы 17.1-21.3 мин; всего 204 мин;
#  стена 60 на ступени 9 — 12Qa, с lateEase — 6Qa.
#  Стены 1 / 3 / 6 — на 7 / 18 / 104 с горы 1; самая долгая стена — 52 с (стена 34). Проверки 01 8.5 № 1-4 и 6 — да;
#  № 5 по логу стен — до ~190 с между кроссовками (точно — в порте, лог тут пишется только на стенах).
#  Проверка 01 8.5 № 3 (каждая гора ступени 0 не короче предыдущей больше чем на 20%): бот-жадина — да.
#  Спамер яиц (SPAM=1): питомцы — случайность, поэтому 20 зёрен и медиана по каждой горе: 25.7 мин
#   (горы 5.3 / 6.0 / 5.3 / 5.0 / 4.5) — да. Цена Морозного яйца 40K: при 30K медиана горы 3 была короче горы 2 на 22%.
#  До 03.10 (вечер) монеты в цикле считались от неокруглённого подарка (160, 320, 640 …), на 4-7% больше игры;
#   переход на nice(gift) сдвинул стены 41-60, wallScale и столбец бота в 01a.
# На M0 проверить perl -v. Perl нет — порт идёт по тексту этого файла, запись в docs/допущения.md.
use strict; use warnings; use POSIX qw(floor);
my $LOG = grep { $_ eq '--log' } @ARGV;

# ---------- параметры (то, что ляжет в balance.json) ----------
my $stepLen = 4; my ($v0, $kv, $vmax) = (16, 0.3, 64);
sub vel { my $s = shift; my $v = $v0 * (1 + $kv * log(1 + $s) / log(10)); $v > $vmax ? $vmax : $v }
my $R = 3;                                            # перерождение: каждый шаг ×3 за ступень
my @shoes = ([1,0],[2,30],[3,200],[5,900],[8,4e3],[12,1.8e4],[20,8e4],[30,3.5e5],[50,1.5e6],
             [80,6.5e6],[120,2.8e7],[200,1.2e8],[300,5e8],[500,2.2e9],[800,9e9],[1200,4e10]);
my @world = (undef,
  { d => 90,  V => 45, I => 50, W => 8 }, { d => 100, V => 48, I => 48, W => 8 },
  { d => 110, V => 52, I => 45, W => 7 }, { d => 120, V => 56, I => 42, W => 7 },
  { d => 130, V => 60, I => 40, W => 6 });
my $spawnAhead = 160; my $giftsPerZone = 6; my $firstWaveAt = 4;   # сценарная лавина у укрытия гейта 4
sub tread { my $p = shift; my $t = 2 * 1.13 ** ($p - 1); my $f = 5 * 1.1 ** ($p - 1); return $t > $f ? $t : $f }   # ×2 … ×~2700
sub gift  { my $p = shift; my $z = int(($p + 1) / 2); return 5 * 2 ** ($z - 1) }   # монет за подарок: зона = 2 стены, ×2 за зону
# яйца: гейт, с которого доступно, цена на ступени 0, пул [бонус, шанс]
my @eggs = (
  { id => "snow", at => 6, price => 500, pool => [[0.10,.50],[0.20,.30],[0.35,.15],[0.60,.045],[1.00,.005]] },
  { id => "frost", at => 13, price => 4e4, pool => [[0.25,.50],[0.40,.30],[0.70,.15],[1.20,.045],[2.00,.005]] },
  { id => "ice", at => 25, price => 3e6, pool => [[0.50,.50],[0.80,.30],[1.30,.15],[2.00,.045],[3.50,.005]] },
  { id => "blizzard", at => 37, price => 3e8, pool => [[0.90,.50],[1.40,.30],[2.20,.15],[3.20,.045],[5.50,.005]] },
  { id => "aurora", at => 49, price => 2e10, pool => [[1.50,.50],[2.20,.30],[3.20,.15],[5.00,.045],[8.00,.005]] });
my $petSlots = 3; our $eggCount = 0; my $spamRun = 0;   # $spamRun = 1 — профиль «Спамер яиц» (SPAM=1)
my @trails = ([1,0],[1.1,3],[1.25,10],[1.5,25],[2,60],[2.5,120],[3,250],[4,500],[5,1000]);   # [множитель, кубков]
my @auras  = ([1,0],[1.2,8],[1.5,30],[2,80],[3,200],[4,450],[6,1000]);
sub trophiesForSummit { my ($w, $n) = @_; return $w * (1 + $n) }
my @worldTarget = (undef, 330, 360, 390, 420, 450);    # бот, секунды на мир, ступень 0
my @w1Target = (undef, 7, 13, 25, 50, 72, 98, 125, 155, 185, 220, 258, 300);   # бот, мир 1, секунды
my @fixedGates = (undef, 20, 40, 80);                  # гейты 1–3 мира 1 — руками (обучение)
my @cycleTarget = (undef, 22, 21, 20, 20, 19, 19, 18, 18, 18);   # минуты цикла ступеней 1..9

# ---------- служебное ----------
my $seed = 12345; sub rnd { $seed = ($seed * 1103515245 + 12345) % 2147483648; return $seed / 2147483648 }
sub nice { my $x = shift; return int($x + 0.5) if $x < 10;
  my $e = 10 ** floor(log($x)/log(10)); my $m = $x / $e; my $best = 1;
  for my $s (1,1.2,1.5,2,2.5,3,4,5,6,8,10) { $best = $s if abs($s-$m) < abs($best-$m) } return $best * $e }
sub up { my $x = shift; my @st = (1,1.2,1.5,2,2.5,3,4,5,6,8,10);
  my $e = 10 ** floor(log($x)/log(10)); for my $s (@st) { return $s*$e if $s*$e > $x*1.0001 } return 10*$e }
sub fmt { my $x = shift; my @suf = ('', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx'); my $i = 0;
  while ($x >= 1000 && $i < $#suf) { $x /= 1000; $i++ }
  my $s = $x >= 100 ? sprintf('%.0f', $x) : $x >= 10 ? sprintf('%.1f', $x) : sprintf('%.2f', $x);
  $s =~ s/\.?0+$// if $s =~ /\./; return $s . $suf[$i] }

my @gate;            # таблица гейтов ступени 0 (p = 1..60)
my %meta;            # постоянное: питомцы (список бонусов), кубки, трейл, аура

sub petMult { my @b = sort { $b <=> $a } @{ $meta{pets} }; my $s = 0;
  for my $i (0 .. $petSlots - 1) { $s += $b[$i] // 0 } return 1 + $s }
sub prunePets { my @b = sort { $b <=> $a } @{ $meta{pets} }; $#b = $petSlots - 1 if @b > $petSlots; $meta{pets} = [@b] }
sub hatch { my $e = shift; my $r = rnd(); my $acc = 0;
  for my $pp (@{ $e->{pool} }) { $acc += $pp->[1]; if ($r <= $acc) { push @{ $meta{pets} }, $pp->[0]; prunePets(); return } }
  push @{ $meta{pets} }, $e->{pool}[-1][0] }
sub spendTrophies { my $bought = 1; while ($bought) { $bought = 0;
    my $nt = $trails[$meta{trail} + 1]; my $na = $auras[$meta{aura} + 1];
    if ($nt && $meta{troph} >= $nt->[1] && (!$na || $nt->[1] <= $na->[1])) { $meta{troph} -= $nt->[1]; $meta{trail}++; $bought = 1 }
    elsif ($na && $meta{troph} >= $na->[1]) { $meta{troph} -= $na->[1]; $meta{aura}++; $bought = 1 } } }

# один цикл (ступень n): от подножия горы 1 до вершины горы 5
sub walkTo { my ($zr, $to, $v, $g, $Sr, $Tr, $phr) = @_; return if $$zr >= $to; my $d = $to - $$zr; $$Tr += $d / $v; $$Sr += $d / $stepLen * $g; $$phr -= $d / $v; $$zr = $to }
sub cycle {
  my ($mode, $n, $Wn, $log) = @_;
  my $step = $R ** $n; my ($S, $C, $shoe) = (0, 0, 0); my $T = 0; my $dt = 0.25; my $waves = 0;
  my %eggBought; my @wt;
  for my $w (1..5) {
    my $Wd = $world[$w]; my $tw0 = $T; my $z = 20; my $zEnd = 40 + 12 * $Wd->{d} + 40;
    my $phase = 'idle'; my $ph_t = $Wd->{I}; my $front = 0; my $giftsLeft = $giftsPerZone;
    my $scripted = ($n == 0 && $w == 1);
    for my $i (1..12) {
      my $p = 12 * ($w - 1) + $i; my $gz = 40 + $i * $Wd->{d}; my $shelter = $gz - 0.3 * $Wd->{d};
      my $req = defined $gate[$p] ? $gate[$p] * $Wn * ($n >= 1 && $p > 36 ? 1 - 0.5 * ($p - 36) / 24 : 1) : undef;
      my $tgt = $tw0 + ($w == 1 ? $w1Target[$i] : $worldTarget[$w] * ($i / 12.4));
      if ($scripted && $i == $firstWaveAt) { $phase = 'warn'; $ph_t = 5 }   # сценарная лавина
      if ($scripted && $i < $firstWaveAt) { $phase = 'idle'; $ph_t = 999 }
      while (1) {
        my $g = $step * $shoes[$shoe][0] * petMult() * $trails[$meta{trail}][0] * $auras[$meta{aura}][0];
        my $v = vel($S);
        $ph_t -= $dt;
        if ($phase eq 'idle' && $ph_t <= 0) { $phase = 'warn'; $ph_t = $Wd->{W} }
        elsif ($phase eq 'warn' && $ph_t <= 0) { $phase = 'run'; $front = $z + $spawnAhead < $zEnd ? $z + $spawnAhead : $zEnd }
        my $hiding = ($phase eq 'warn' || ($phase eq 'run' && $front > $z));
        if ($phase eq 'run') { $front -= $Wd->{V} * $dt;
          if ($front <= 40) { $phase = 'idle'; $ph_t = $Wd->{I}; $giftsLeft = $giftsPerZone; $waves++; $C += 3 * nice(gift($p)) * $Wn } }
        my $ready = ($mode eq 'inverse' && !defined $req) ? ($T >= $tgt) : ($S >= $req);
        if ($hiding) { walkTo(\$z, $shelter, $v, $g, \$S, \$T, \$ph_t); $S += $v / $stepLen * $g * tread($p) * $dt; $z = $shelter }
        elsif ($ready) {
          my $dist = $gz - $z; my $tt = $dist / $v; $tt = 0.5 if $tt < 0.5;
          $S += $dist / $stepLen * $g; $T += $tt; $z = $gz + 5; $C += 2 * nice(gift($p)) * $Wn; last }
        elsif ($giftsLeft > 0 && !($scripted && $i < $firstWaveAt && $T < 3)) {
          $S += $v * 2 / $stepLen * $g; $T += 2; $giftsLeft--; $C += nice(gift($p)) * $Wn; $ph_t -= 2 - $dt; walkTo(\$z, $shelter, $v, $g, \$S, \$T, \$ph_t); next }
        else { walkTo(\$z, $shelter, $v, $g, \$S, \$T, \$ph_t); $S += $v / $stepLen * $g * tread($p) * $dt; $z = $shelter }
        $T += $dt;
        if ($spamRun) { my ($be) = grep { $p >= $_->{at} } reverse @eggs; my $k = 0;   # спамер: сначала лучшее открытое яйцо, кроссовки — на остаток
          while ($be && $C >= $be->{price} * $Wn && $k++ < 200) { $C -= $be->{price} * $Wn; hatch($be); $eggCount++ } }
        while ($shoe < $#shoes && $C >= $shoes[$shoe+1][1] * $Wn) { $C -= $shoes[$shoe+1][1] * $Wn; $shoe++ }
        if ($spamRun) { }                                                               # яйца спамера уже куплены выше
        elsif (!$ENV{ONCE}) { my ($be) = grep { $p >= $_->{at} } reverse @eggs;
          if ($be) { my $ns = $shoe < $#shoes ? $shoes[$shoe+1][1] * $Wn : 1e300; my $k = 0;
            while ($C >= $be->{price} * $Wn && $ns >= 4 * $be->{price} * $Wn && $k++ < 200) { $C -= $be->{price} * $Wn; hatch($be); $eggCount++ } } }
        else {
        for my $e (@eggs) { next if $p < $e->{at} || $eggBought{$e->{id}};
          if ($C >= $e->{price} * $Wn) { $C -= $e->{price} * $Wn; hatch($e); $eggBought{$e->{id}} = 1 } }
        }
        if ($T > 4 * 3600) { return (1e9, \@wt) }
      }
      if ($scripted && $i == 3) { push @{ $meta{pets} }, 0.2; prunePets() }          # бесплатное яйцо обучения: +20%
      if ($mode eq 'inverse' && !defined $gate[$p]) { my $x = nice($S / $Wn * 0.97);
        $x = up($gate[$p-1]) if $p > 1 && $x <= $gate[$p-1]; $gate[$p] = $x }
      push @$log, sprintf("%d-%02d %6.0fс (мир %4.0fс) стат %-7s стена %-7s v=%4.1f кроссовки L%-2d ×%-4s питомцы ×%-5.2f дорожка ×%-5s подарок %-6s монеты %s",
        $w, $i, $T, $T-$tw0, fmt($S), fmt($gate[$p]*$Wn), vel($S), $shoe, $shoes[$shoe][0], petMult(), fmt(nice(tread($p))), fmt(nice(gift($p))*$Wn), fmt($C)) if $log;
    }
    $T += 40 / vel($S); $C += 25 * nice(gift(12 * $w)) * $Wn; $meta{troph} += trophiesForSummit($w, $n);
    # перед перерождением бот тратит монеты на лучшее доступное яйцо
    if ($w == 5) { for my $e (reverse @eggs) { my $k = 0; while ($C >= $e->{price} * $Wn && $k++ < 10) { $C -= $e->{price} * $Wn; hatch($e) } } }
    push @wt, ($T - $tw0) / 60;
  }
  spendTrophies();
  return ($T / 60, \@wt);
}

# шаг 1–2: ступень 0
@gate[1..3] = @fixedGates[1..3];
%meta = (pets => [], troph => 0, trail => 0, aura => 0);
cycle('inverse', 0, 1, undef);
print "Гейты ступени 0:\n"; for my $w (1..5) { print " мир $w: ", join(', ', map { fmt($gate[12*($w-1)+$_]) } 1..12), "\n" }
print " дорожки по гейтам: ", join(' ', map { fmt(nice(tread($_))) } 1..60), "\n";
print " подарки по гейтам: ", join(' ', map { fmt(nice(gift($_))) } 1..60), "\n";
%meta = (pets => [], troph => 0, trail => 0, aura => 0); $seed = 12345;
my @log0; my ($t0, $wt0) = cycle('check', 0, 1, \@log0);
print join("\n", @log0), "\n" if $LOG;
printf "\nСтупень 0: %.1f мин (миры: %s), питомцы ×%.2f, кубков %d\n", $t0, join(' / ', map { sprintf '%.1f', $_ } @$wt0), petMult(), $meta{troph};
# проверка 01 8.5 № 3: каждая гора ступени 0 не короче предыдущей больше чем на 20%
sub mountainCheck { my $wt = shift; my @bad = grep { $wt->[$_] < 0.8 * $wt->[$_ - 1] } 1 .. $#$wt;
  return @bad ? 'НЕТ: ' . join('; ', map { sprintf 'гора %d короче горы %d на %.0f%%', $_ + 1, $_, 100 * (1 - $wt->[$_] / $wt->[$_ - 1]) } @bad) : 'да' }
printf "Горы не короче предыдущей больше чем на 20%%: %s\n", mountainCheck($wt0);
if ($ENV{SPAM}) {   # «Спамер яиц»: прямой прогон ступени 0 по той же таблице; состояние бота-жадины потом возвращается
  # питомцы — случайность: одно зерно не показатель, поэтому 20 зёрен и медиана по каждой горе
  my %mk = (%meta, pets => [@{ $meta{pets} }]); my $sk = $seed; my @all; my $pass = 0; my $nSeeds = 20;
  for my $k (0 .. $nSeeds - 1) {
    %meta = (pets => [], troph => 0, trail => 0, aura => 0); $seed = 12345 + 7919 * $k; $spamRun = 1; $eggCount = 0;
    my ($ts, $wts) = cycle('check', 0, 1, undef); $spamRun = 0;
    push @all, [$ts, @$wts]; $pass++ if mountainCheck($wts) eq 'да';
    printf "Спамер яиц, зерно %-6d: %.1f мин (миры: %s), питомцы ×%.2f, яиц куплено %d, проверка 20%%: %s\n", 12345 + 7919 * $k, $ts,
      join(' / ', map { sprintf '%.1f', $_ } @$wts), petMult(), $eggCount, mountainCheck($wts) if $LOG || $k == 0;
  }
  my @med = map { my $j = $_; my @s = sort { $a <=> $b } map { $_->[$j] } @all; ($s[$nSeeds / 2 - 1] + $s[$nSeeds / 2]) / 2 } 0 .. 5;
  printf "Спамер яиц, медиана %d зёрен: %.1f мин (миры: %s); горы не короче предыдущей больше чем на 20%%: %s; зёрен без провала: %d из %d\n",
    $nSeeds, $med[0], join(' / ', map { sprintf '%.1f', $_ } @med[1 .. 5]), mountainCheck([@med[1 .. 5]]), $pass, $nSeeds;
  %meta = %mk; $seed = $sk;
}

# шаг 3: ступени 1..9
my $total = $t0; my @Wtab = (1);
for my $n (1..9) {
  my %m0 = (%meta, pets => [@{ $meta{pets} }]); my $s0 = $seed;
  my ($lo, $hi) = (log($R ** $n), log($R ** $n) + 20); my ($tn, $wtn);
  for (1..40) { my $mid = ($lo + $hi) / 2; %meta = (%m0, pets => [@{ $m0{pets} }]); $seed = $s0;
    ($tn, $wtn) = cycle('check', $n, exp($mid), undef); if ($tn < $cycleTarget[$n]) { $lo = $mid } else { $hi = $mid } }
  my @fixedW = (1, 12, 50, 200, 800, 3e3, 12e3, 5e4, 2e5, 8e5);
  my $Wn = $ENV{FIXEDW} ? $fixedW[$n] : nice(exp($lo)); %meta = (%m0, pets => [@{ $m0{pets} }]); $seed = $s0;
  ($tn, $wtn) = cycle('check', $n, $Wn, undef); $total += $tn; push @Wtab, $Wn;
  printf "Ступень %d: горы ×%-7s шаг ×%-6s цикл %.1f мин (миры: %s), питомцы ×%.2f, трейл ×%s, аура ×%s, всего %.0f мин\n",
    $n, fmt($Wn), fmt($R ** $n), $tn, join(' / ', map { sprintf '%.1f', $_ } @$wtn), petMult(), $trails[$meta{trail}][0], $auras[$meta{aura}][0], $total;
}
printf "Стена 60 на ступени 9: %s, с lateEase (x0.5) — %s\n", fmt($gate[60] * $Wtab[9]), fmt($gate[60] * $Wtab[9] * 0.5);

# --md: таблица 60 стен для 01a-content.md (ступень 0, бот — секунды прохода с начала горы)
if (grep { $_ eq '--md' } @ARGV) {
  my @rows; my $cur;
  for my $l (@log0) { if ($l =~ /^(\d)-(\d\d)\s+(\d+)с \(мир\s+(\d+)с\)/) { $rows[12*($1-1)+$2] = $4 } }
  print "\n| № | Гора | Стена в горе | Требование | Дорожка в пещере перед стеной | Зона (цвет) | Подарок, монет | За проход стены | Бот: секунда горы |\n|---|---|---|---|---|---|---|---|---|\n";
  my @rar = ('Обычная','Необычная','Редкая','Эпическая','Легендарная','Мифическая');
  for my $p (1..60) { my $w = int(($p-1)/12)+1; my $i = $p - 12*($w-1); my $z = int(($p+1)/2); my $k = ($z-1) % 6;
    printf "| %d | %d | %d | %s | ×%s | %d (%s) | %s | %s | %s |\n", $p, $w, $i, fmt($gate[$p]), fmt(nice(tread($p))), $z, $rar[$k], fmt(nice(gift($p))), fmt(2 * nice(gift($p))), $rows[$p] // '' }
}
