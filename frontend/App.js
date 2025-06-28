import 'react-native-gesture-handler';
import React, { useState, useEffect, useMemo } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Modal,
  Button,
  Platform,
  Dimensions,
  TextInput,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { LineChart } from 'react-native-chart-kit';

// const API_BASE     = 'http://localhost:4000'; // Use your local server or deployed URL
const API_BASE     = 'https://clinic-scraper.fly.dev';
const SCREEN_WIDTH = Dimensions.get('window').width - 48; // More margin for mobile

// Enhanced color palette
const COLORS = {
  primary: '#6C63FF',
  primaryLight: '#8B83FF',
  primaryDark: '#5A52CC',
  secondary: '#FF6B9D',
  secondaryLight: '#FF8FB3',
  accent: '#4ECDC4',
  success: '#00D4AA',
  warning: '#FFB946',
  error: '#FF6B6B',
  dark: '#2D3748',
  gray: '#718096',
  lightGray: '#F7FAFC',
  white: '#FFFFFF',
  background: '#F8FAFC',
  cardBackground: '#FFFFFF',
  gradientStart: '#667eea',
  gradientEnd: '#764ba2',
};

const LOCATIONS        = ['All','Oak Lawn','Orland Park','Albany Park','Buffalo Grove','OakBrook','Schaumburg'];
const LOCATIONS_NO_ALL = LOCATIONS.slice(1);
const MONTH_NAMES      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PRESETS = {
  'Today':        () => { const d=new Date().toISOString().slice(0,10); return {startDate:d,endDate:d}; },
  'Yesterday':    () => { const d=new Date(); d.setDate(d.getDate()-1); const s=d.toISOString().slice(0,10); return {startDate:s,endDate:s}; },
  'Week To Date': () => {
    const now=new Date(), mon=new Date(now);
    mon.setDate(now.getDate() - ((now.getDay()+6)%7));
    return { startDate:mon.toISOString().slice(0,10), endDate:now.toISOString().slice(0,10) };
  },
  'Month To Date':() => {
    const now=new Date(), first=new Date(now.getFullYear(),now.getMonth(),1);
    return { startDate:first.toISOString().slice(0,10), endDate:now.toISOString().slice(0,10) };
  },
  'Year To Date': () => {
    const now=new Date(), first=new Date(now.getFullYear(),0,1);
    return { startDate:first.toISOString().slice(0,10), endDate:now.toISOString().slice(0,10) };
  },
};

const chartConfig = {
  backgroundGradientFrom: COLORS.white,
  backgroundGradientTo:   COLORS.white,
  decimalPlaces:          0,
  color:       (opacity=1) => `rgba(108, 99, 255, ${opacity})`,
  labelColor:  (opacity=1) => `rgba(45, 55, 72, ${opacity})`,
  style:                { borderRadius:16 },
  propsForDots:         { r:'6', strokeWidth:'3', stroke: COLORS.primary },
  propsForBackgroundLines: { strokeWidth: 1, stroke: '#E2E8F0' },
  strokeWidth: 3,
  fillShadowGradientFrom: COLORS.primary,
  fillShadowGradientTo: COLORS.primaryLight,
  fillShadowGradientFromOpacity: 0.1,
  fillShadowGradientToOpacity: 0.0,
};

const Tab = createBottomTabNavigator();

// — reusable modal dropdown —
function ModalDropdown({ label, options, selected, onChange }) {
  const [visible, setVisible] = useState(false);
  return <>
    <TouchableOpacity style={styles.selectorButton} onPress={()=>setVisible(true)}>
      <Text style={styles.selectorLabel}>{label}</Text>
      <Text style={styles.selectorText}>{selected}</Text>
      <View style={styles.selectorIndicator}>
        <Text style={styles.chevron}>▼</Text>
      </View>
    </TouchableOpacity>
    <Modal transparent animationType="slide" visible={visible}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{label}</Text>
            <TouchableOpacity onPress={()=>setVisible(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={selected}
              onValueChange={v=>onChange(v)}
              style={styles.modalPicker}
              itemStyle={styles.pickerItem}
            >
              {options.map(o=> <Picker.Item key={o} label={o} value={o}/> )}
            </Picker>
          </View>
          <TouchableOpacity style={styles.doneButton} onPress={()=>setVisible(false)}>
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  </>;
}

// — unified time‐range picker as modal —
function TimeRangePicker({ onRangeChange }) {
  const [visible, setVisible]   = useState(false);
  const [mode, setMode]         = useState('Preset');
  const [preset, setPreset]     = useState('Today');
  const [custom, setCustom]     = useState({ start:new Date(), end:new Date() });
  const [monthYear, setMonth]   = useState({ month:new Date().getMonth(), year:new Date().getFullYear() });
  const [showDP, setShowDP]     = useState(null);

  // compute dates
  const computed = useMemo(() => {
    if (mode==='Preset') return PRESETS[preset]();
    if (mode==='Custom') {
      return {
        startDate: custom.start.toISOString().slice(0,10),
        endDate:   custom.end  .toISOString().slice(0,10),
      };
    }
    // By month
    const s = new Date(monthYear.year, monthYear.month, 1).toISOString().slice(0,10);
    const e = new Date(monthYear.year, monthYear.month+1, 0).toISOString().slice(0,10);
    return { startDate:s, endDate:e };
  }, [mode,preset,custom,monthYear]);

  // **always** notify parent on mount and whenever computed changes
  useEffect(() => {
    onRangeChange(computed);
  }, [computed]);

  return <>
    <TouchableOpacity style={styles.selectorButton} onPress={()=>setVisible(true)}>
      <Text style={styles.selectorLabel}>Date Range</Text>
      <Text style={styles.selectorText}>
        {computed.startDate} → {computed.endDate}
      </Text>
      <View style={styles.selectorIndicator}>
        <Text style={styles.chevron}>▼</Text>
      </View>
    </TouchableOpacity>
    <Modal transparent animationType="slide" visible={visible}>
      <View style={styles.modalOverlay}>
        <ScrollView contentContainerStyle={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Date Range</Text>
            <TouchableOpacity onPress={()=>setVisible(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modeSelector}>
            {['Preset','Custom','ByMonth'].map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.modeButton, mode === m && styles.modeButtonActive]}
                onPress={() => setMode(m)}
              >
                <Text style={[styles.modeButtonText, mode === m && styles.modeButtonTextActive]}>
                  {m}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {mode==='Preset' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Quick Select</Text>
              <View style={styles.presetGrid}>
                {Object.keys(PRESETS).map(p=>(
                  <TouchableOpacity
                    key={p}
                    style={[styles.presetButton, preset === p && styles.presetButtonActive]}
                    onPress={() => setPreset(p)}
                  >
                    <Text style={[styles.presetButtonText, preset === p && styles.presetButtonTextActive]}>
                      {p}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {mode==='ByMonth' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Select Month & Year</Text>
              <View style={styles.pickerRow}>
                <View style={styles.pickerWrapper}>
                  <Text style={styles.pickerLabel}>Month</Text>
                  <View style={styles.pickerContainer}>
                    <Picker
                      selectedValue={monthYear.month}
                      onValueChange={m=>setMonth(y=>({...y,month:m}))}
                      style={styles.modalPicker}
                      itemStyle={styles.pickerItem}
                    >
                      {MONTH_NAMES.map((m,i)=>
                        <Picker.Item key={m} label={m} value={i}/>
                      )}
                    </Picker>
                  </View>
                </View>
                <View style={styles.pickerWrapper}>
                  <Text style={styles.pickerLabel}>Year</Text>
                  <View style={styles.pickerContainer}>
                    <Picker
                      selectedValue={monthYear.year}
                      onValueChange={y=>setMonth(m=>({...m,year:y}))}
                      style={styles.modalPicker}
                      itemStyle={styles.pickerItem}
                    >
                      {[2023,2024,2025].map(y=>
                        <Picker.Item key={y} label={`${y}`} value={y}/>
                      )}
                    </Picker>
                  </View>
                </View>
              </View>
            </View>
          )}

          {mode==='Custom' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Custom Date Range</Text>
              <View style={styles.dateInputs}>
                <View style={styles.dateInput}>
                  <Text style={styles.dateLabel}>Start Date</Text>
                  {Platform.OS === 'web' ? (
                    <TextInput
                      style={styles.webDateInput}
                      value={custom.start.toISOString().slice(0,10)}
                      onChangeText={(text) => {
                        const date = new Date(text);
                        if (!isNaN(date.getTime())) {
                          setCustom(c => ({...c, start: date}));
                        }
                      }}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={COLORS.gray}
                    />
                  ) : (
                    <TouchableOpacity style={styles.dateButton} onPress={()=>setShowDP('start')}>
                      <Text style={styles.dateButtonText}>{custom.start.toISOString().slice(0,10)}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.dateInput}>
                  <Text style={styles.dateLabel}>End Date</Text>
                  {Platform.OS === 'web' ? (
                    <TextInput
                      style={styles.webDateInput}
                      value={custom.end.toISOString().slice(0,10)}
                      onChangeText={(text) => {
                        const date = new Date(text);
                        if (!isNaN(date.getTime())) {
                          setCustom(c => ({...c, end: date}));
                        }
                      }}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={COLORS.gray}
                    />
                  ) : (
                    <TouchableOpacity style={styles.dateButton} onPress={()=>setShowDP('end')}>
                      <Text style={styles.dateButtonText}>{custom.end.toISOString().slice(0,10)}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              {showDP && Platform.OS !== 'web' && (
                <DateTimePicker
                  value={custom[showDP]}
                  mode="date"
                  display={Platform.OS==='ios'?'spinner':'calendar'}
                  onChange={(_,d)=>{ setShowDP(null); if(d) setCustom(c=>({...c,[showDP]:d})); }}
                />
              )}
            </View>
          )}

          <TouchableOpacity style={styles.doneButton} onPress={()=>setVisible(false)}>
            <Text style={styles.doneButtonText}>Apply Selection</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  </>;
}

// — Leaderboard Tab —
function LeaderboardScreen() {
  const [location, setLocation] = useState('All');
  const [range,    setRange]    = useState(PRESETS['Today']());
  const [data,     setData]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs  = new URLSearchParams({ location, ...range }).toString();
        const res = await fetch(`${API_BASE}/api/leaderboard?${qs}`);
        if (!res.ok) throw new Error(res.status);
        setData(await res.json());
      } catch(e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [location, range]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerGradient}>
        <Text style={styles.screenTitle}>🏆 Doctor Leaderboard</Text>
        <Text style={styles.screenSubtitle}>Top performing doctors by patient visits</Text>
      </View>
      
      <View style={styles.headerRow}>
        <ModalDropdown label="Location" options={LOCATIONS} selected={location} onChange={setLocation}/>
        <TimeRangePicker onRangeChange={setRange}/>
      </View>
      
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary}/>
          <Text style={styles.loadingText}>Loading leaderboard...</Text>
        </View>
      )}
      
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorText}>Error: {error}</Text>
        </View>
      )}
      
      <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {data.map(g=>(
          <View key={g.location} style={styles.leaderboardCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>📍 {g.location}</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{g.leaderboard.length} doctors</Text>
              </View>
            </View>
            {g.leaderboard.length>0
              ? g.leaderboard.map((d,i)=>(
                  <View key={d.doctor} style={[styles.lbRow, i === 0 && styles.lbRowFirst]}>
                    <View style={[styles.rankBadge, i === 0 && styles.rankBadgeGold, i === 1 && styles.rankBadgeSilver, i === 2 && styles.rankBadgeBronze]}>
                      <Text style={[styles.rankText, i < 3 && styles.rankTextMedal]}>{i+1}</Text>
                    </View>
                    <View style={styles.doctorInfo}>
                      <Text style={styles.lbDoctor}>Dr. {d.doctor}</Text>
                      {i === 0 && <Text style={styles.topPerformer}>🥇 Top Performer</Text>}
                    </View>
                    <View style={styles.countBadge}>
                      <Text style={styles.lbCount}>{d.count}</Text>
                      <Text style={styles.visitLabel}>visits</Text>
                    </View>
                  </View>
                ))
              : (
                <View style={styles.noDataContainer}>
                  <Text style={styles.noDataIcon}>📊</Text>
                  <Text style={styles.noDataText}>No data available</Text>
                  <Text style={styles.noDataSubtext}>Try selecting a different date range</Text>
                </View>
              )
            }
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// — KPIs Tab —
function KPIsScreen() {
  const [location, setLocation] = useState('All');
  const [range,    setRange]    = useState(PRESETS['Today']());
  const [kpiType,  setKpiType]  = useState('location');
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs  = new URLSearchParams({ location, ...range }).toString();
        const res = await fetch(`${API_BASE}/api/kpis?${qs}`);
        if (!res.ok) throw new Error(res.status);
        setData(await res.json());
      } catch(e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [location, range]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerGradient}>
        <Text style={styles.screenTitle}>📊 Key Performance Indicators</Text>
        <Text style={styles.screenSubtitle}>Track clinic performance metrics</Text>
      </View>
      
      <View style={styles.headerRow}>
        <ModalDropdown label="Location"  options={LOCATIONS} selected={location} onChange={setLocation}/>
        <TimeRangePicker             onRangeChange={setRange}/>
        <ModalDropdown label="View" options={['location','doctor']} selected={kpiType} onChange={setKpiType}/>
      </View>

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary}/>
          <Text style={styles.loadingText}>Loading KPIs...</Text>
        </View>
      )}
      
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorText}>Error: {error}</Text>
        </View>
      )}
      
      {!loading && !error && (
        <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          {kpiType === 'location'
            ? data.byLocation.map(l => {
                const max = Math.max(...data.byLocation.map(x=>x.patientsSeen),1);
                const pct = (l.patientsSeen/max)*100;
                return (
                  <View key={l.location} style={styles.kpiCard}>
                    <View style={styles.kpiHeader}>
                      <Text style={styles.kpiTitle}>📍 {l.location}</Text>
                      <View style={styles.kpiValue}>
                        <Text style={styles.kpiNumber}>{l.patientsSeen}</Text>
                        <Text style={styles.kpiLabel}>patients</Text>
                      </View>
                    </View>
                    <View style={styles.progressBarContainer}>
                      <View style={styles.progressBarTrack}>
                        <View style={[styles.progressBarFill, {width: `${pct}%`}]} />
                      </View>
                      <Text style={styles.progressPercentage}>{Math.round(pct)}%</Text>
                    </View>
                  </View>
                );
              })
            : data.byDoctor.map(group => {
                return (
                  <View key={group.location} style={styles.kpiCard}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardTitle}>👨‍⚕️ Doctors - {group.location}</Text>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{group.perDoctor.length} doctors</Text>
                      </View>
                    </View>
                    {group.perDoctor.map((d, index) => {
                      const max = group.perDoctor[0]?.count||1;
                      const pct = (d.count/max)*100;
                      return (
                        <View key={d.doctor} style={[styles.doctorKpiRow, index === 0 && styles.topDoctorRow]}>
                          <View style={styles.doctorKpiInfo}>
                            <Text style={styles.doctorKpiName}>Dr. {d.doctor}</Text>
                            {index === 0 && <Text style={styles.topDoctorBadge}>🏆 Top</Text>}
                          </View>
                          <View style={styles.doctorKpiMetrics}>
                            <View style={styles.progressBarContainer}>
                              <View style={styles.progressBarTrack}>
                                <View style={[styles.progressBarFill, {width: `${pct}%`}]} />
                              </View>
                            </View>
                            <View style={styles.doctorKpiValue}>
                              <Text style={styles.doctorKpiNumber}>{d.count}</Text>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                );
              })
          }
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// — Comparison Tab —
function ComparisonScreen() {
  const [location, setLocation] = useState(LOCATIONS_NO_ALL[0]);
  const [range,    setRange]    = useState(PRESETS['Year To Date']());
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs  = new URLSearchParams({ location, ...range }).toString();
        const res = await fetch(`${API_BASE}/api/comparison?${qs}`);
        if (!res.ok) throw new Error(res.status);
        setData(await res.json());
      } catch(e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [location, range]);

  if (loading) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary}/>
        <Text style={styles.loadingText}>Loading comparison data...</Text>
      </View>
    </SafeAreaView>
  );
  
  if (error) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>Error: {error}</Text>
      </View>
    </SafeAreaView>
  );
  
  if (!data) return null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerGradient}>
        <Text style={styles.screenTitle}>📈 Year-over-Year Comparison</Text>
        <Text style={styles.screenSubtitle}>Compare performance trends</Text>
      </View>
      
      <View style={styles.headerRow}>
        <ModalDropdown label="Location" options={LOCATIONS_NO_ALL} selected={location} onChange={setLocation}/>
      </View>
      
      <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Monthly Patient Visits</Text>
            <View style={styles.legendContainer}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, {backgroundColor: COLORS.primary}]} />
                <Text style={styles.legendText}>This Year</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, {backgroundColor: COLORS.secondary}]} />
                <Text style={styles.legendText}>Last Year</Text>
              </View>
            </View>
          </View>
          
          <LineChart
            data={{
              labels: data.months,
              datasets:[
                { 
                  data:data.thisYear, 
                  color:()=> COLORS.primary, 
                  strokeWidth:4 
                },
                { 
                  data:data.lastYear, 
                  color:()=> COLORS.secondary, 
                  strokeWidth:4 
                },
              ],
            }}
            width={Math.min(SCREEN_WIDTH, Dimensions.get('window').width - 64)}
            height={280}
            chartConfig={{
              ...chartConfig,
              propsForBackgroundLines: { strokeWidth: 1, stroke: '#E2E8F0' },
              paddingRight: 50, // Add padding to prevent cutoff
            }}
            style={styles.chart}
            withShadow={false}
            withDots={true}
            withInnerLines={true}
            withOuterLines={true}
            withVerticalLines={true}
            withHorizontalLines={true}
            fromZero={true}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: COLORS.white,
            borderTopWidth: 0,
            elevation: 20,
            shadowColor: COLORS.dark,
            shadowOffset: { width: 0, height: -5 },
            shadowOpacity: 0.1,
            shadowRadius: 10,
            height: 90,
            paddingBottom: 20,
            paddingTop: 10,
          },
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.gray,
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '600',
            marginTop: 5,
          },
          tabBarIconStyle: {
            marginTop: 5,
          },
        }}
      >
        <Tab.Screen 
          name="Leaderboard" 
          component={LeaderboardScreen}
          options={{
            tabBarIcon: ({ color, size }) => (
              <Text style={{ fontSize: 24, color }}>🏆</Text>
            ),
          }}
        />
        <Tab.Screen 
          name="KPIs" 
          component={KPIsScreen}
          options={{
            tabBarIcon: ({ color, size }) => (
              <Text style={{ fontSize: 24, color }}>📊</Text>
            ),
          }}
        />
        <Tab.Screen 
          name="Comparison" 
          component={ComparisonScreen}
          options={{
            tabBarIcon: ({ color, size }) => (
              <Text style={{ fontSize: 24, color }}>📈</Text>
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  safe: { 
    flex: 1, 
    backgroundColor: COLORS.background 
  },

  // Header styles
  headerGradient: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.white,
    marginBottom: 4,
  },
  screenSubtitle: {
    fontSize: 16,
    color: COLORS.white,
    opacity: 0.9,
    fontWeight: '400',
  },

  // Header row with selectors
  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: 12,
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: -12,
    borderRadius: 16,
    shadowColor: COLORS.dark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },

  // Selector button styles
  selectorButton: {
    flex: 1,
    minWidth: 120, // Ensure minimum width
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: 12,
    minHeight: 80,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  selectorLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  selectorText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
    flex: 1,
    flexWrap: 'wrap',
    lineHeight: 18,
  },
  selectorIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  chevron: {
    fontSize: 10,
    color: COLORS.gray,
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    paddingTop: Platform.OS !== 'web' ? 60 : 0, // Add top padding on mobile to avoid camera cutout
  },
  modalCard: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.dark,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.lightGray,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 18,
    color: COLORS.gray,
    fontWeight: 'bold',
  },

  // Mode selector
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: COLORS.primary,
  },
  modeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray,
  },
  modeButtonTextActive: {
    color: COLORS.white,
  },

  // Section styles
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.dark,
    marginBottom: 16,
  },

  // Preset grid
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: COLORS.lightGray,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  presetButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  presetButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray,
  },
  presetButtonTextActive: {
    color: COLORS.white,
  },

  // Picker styles
  pickerRow: {
    flexDirection: 'row',
    gap: 16,
  },
  pickerWrapper: {
    flex: 1,
  },
  pickerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray,
    marginBottom: 8,
  },
  pickerContainer: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalPicker: {
    height: 150,
  },
  pickerItem: {
    fontSize: 16,
    color: COLORS.dark,
  },

  // Date inputs
  dateInputs: {
    gap: 16,
  },
  dateInput: {
    marginBottom: 16,
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray,
    marginBottom: 8,
  },
  dateButton: {
    backgroundColor: COLORS.lightGray,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  dateButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.dark,
    textAlign: 'center',
  },
  webDateInput: {
    backgroundColor: COLORS.lightGray,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.dark,
    textAlign: 'center',
  },

  // Done button
  doneButton: {
    backgroundColor: COLORS.primary,
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },

  // Loading and error states
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.gray,
    fontWeight: '500',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  errorIcon: {
    fontSize: 48,
  },
  errorText: {
    fontSize: 18,
    color: COLORS.error,
    textAlign: 'center',
    fontWeight: '600',
  },

  // Scroll container
  scrollContainer: {
    flex: 1,
    paddingTop: 16,
  },

  // Card styles
  leaderboardCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 20,
    shadowColor: COLORS.dark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  kpiCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 20,
    shadowColor: COLORS.dark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  chartCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 20,
    shadowColor: COLORS.dark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },

  // Card headers
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.dark,
    flex: 1,
  },
  badge: {
    backgroundColor: COLORS.lightGray,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray,
  },

  // Leaderboard rows
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  lbRowFirst: {
    backgroundColor: COLORS.lightGray,
    marginHorizontal: -20,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderBottomWidth: 0,
    marginBottom: 8,
  },
  rankBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.lightGray,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  rankBadgeGold: {
    backgroundColor: '#FFD700',
  },
  rankBadgeSilver: {
    backgroundColor: '#C0C0C0',
  },
  rankBadgeBronze: {
    backgroundColor: '#CD7F32',
  },
  rankText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray,
  },
  rankTextMedal: {
    color: COLORS.white,
  },
  doctorInfo: {
    flex: 1,
  },
  lbDoctor: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.dark,
  },
  topPerformer: {
    fontSize: 12,
    color: COLORS.warning,
    fontWeight: '600',
    marginTop: 2,
  },
  countBadge: {
    alignItems: 'center',
    minWidth: 60,
  },
  lbCount: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primary,
    textAlign: 'center',
  },
  visitLabel: {
    fontSize: 12,
    color: COLORS.gray,
    fontWeight: '500',
  },

  // No data states
  noDataContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  noDataIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  noDataText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.gray,
    marginBottom: 8,
  },
  noDataSubtext: {
    fontSize: 14,
    color: COLORS.gray,
    textAlign: 'center',
  },

  // KPI specific styles
  kpiHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  kpiTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.dark,
    flex: 1,
    minWidth: 120,
    marginRight: 8,
  },
  kpiValue: {
    alignItems: 'center',
    minWidth: 80,
    maxWidth: 120,
  },
  kpiNumber: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.primary,
    textAlign: 'center',
  },
  kpiLabel: {
    fontSize: 12,
    color: COLORS.gray,
    fontWeight: '500',
  },

  // Progress bars
  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  progressBarTrack: {
    flex: 1,
    height: 8,
    backgroundColor: COLORS.lightGray,
    borderRadius: 4,
    overflow: 'hidden',
    minWidth: 60,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },
  progressPercentage: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray,
    minWidth: 35,
    textAlign: 'right',
  },

  // Doctor KPI rows
  doctorKpiRow: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  topDoctorRow: {
    backgroundColor: COLORS.lightGray,
    marginHorizontal: -20,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderBottomWidth: 0,
    marginBottom: 8,
  },
  doctorKpiInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  doctorKpiName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.dark,
    flex: 1,
  },
  topDoctorBadge: {
    fontSize: 12,
    color: COLORS.warning,
    fontWeight: '600',
  },
  doctorKpiMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  doctorKpiValue: {
    minWidth: 50,
    maxWidth: 80,
    alignItems: 'center',
  },
  doctorKpiNumber: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primary,
    textAlign: 'center',
  },

  // Chart styles
  chartHeader: {
    marginBottom: 20,
  },
  chartTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.dark,
    marginBottom: 12,
  },
  legendContainer: {
    flexDirection: 'row',
    gap: 20,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray,
  },
  chart: {
    borderRadius: 16,
    marginVertical: 8,
  },
});
