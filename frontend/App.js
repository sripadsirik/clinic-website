// frontend/App.js
import React, { useState, useEffect, useCallback } from 'react'
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  Button,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
  Keyboard,
  ScrollView,
} from 'react-native'
import Constants from 'expo-constants'
import { Picker } from '@react-native-picker/picker'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'

// expo.extra → your dev & prod URLs
const configExtra =
  (Constants.manifest  && Constants.manifest.extra)  ||
  (Constants.expoConfig && Constants.expoConfig.extra) ||
  {}
const {
  apiBaseDev  = 'http://192.168.68.79:4000',
  apiBaseProd = 'https://api.yourclinic.com',
} = configExtra
const API_BASE = __DEV__ ? apiBaseDev : apiBaseProd

function HomeScreen({ navigation }) {
  const [location,  setLocation]  = useState('Oak Lawn')
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')

  const onFetch = useCallback(() => {
    const iso = /^\d{4}-\d{2}-\d{2}$/
    if (!iso.test(startDate) || !iso.test(endDate)) {
      Alert.alert('Invalid Dates', 'Please use YYYY-MM-DD format.')
      return
    }
    if (startDate > endDate) {
      Alert.alert('Invalid Range', 'Start date must be on or before end date.')
      return
    }
    Keyboard.dismiss()
    navigation.navigate('Results', { location, startDate, endDate })
  }, [location, startDate, endDate, navigation])

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Location</Text>
        <View style={styles.pickerWrapper}>
          <Picker selectedValue={location} onValueChange={setLocation}>
            {[
              'Oak Lawn',
              'Orland Park',
              'Albany Park',
              'Buffalo Grove',
              'OakBrook',
              'Schaumburg',
            ].map(loc => <Picker.Item key={loc} label={loc} value={loc} />)}
          </Picker>
        </View>

        <Text style={styles.label}>Start Date (YYYY-MM-DD)</Text>
        <TextInput
          style={styles.input}
          value={startDate}
          onChangeText={setStartDate}
          placeholder="2025-06-18"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
        />

        <Text style={styles.label}>End Date (YYYY-MM-DD)</Text>
        <TextInput
          style={styles.input}
          value={endDate}
          onChangeText={setEndDate}
          placeholder="2025-06-19"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
        />

        <View style={styles.buttonWrapper}>
          <Button title="Show Leaderboard" onPress={onFetch} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ResultsScreen({ route, navigation }) {
  const { location, startDate, endDate } = route.params
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // Which statuses to count per location
  const statusMap = {
    'Orland Park': ['MD Exit','OD Exit'],
    'Oak Lawn':    ['MD Exit','OD/Post-Op Exit'],
    'Albany Park': ['Exit'],
    'Buffalo Grove': ['Exit'],
    'OakBrook':    ['Exit'],
    'Schaumburg':  ['Exit'],
  }
  const wantedStatuses = statusMap[location] || []

  const fetchVisits = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const qs  = new URLSearchParams({ location, startDate, endDate }).toString()
      const url = `${API_BASE}/api/visits?${qs}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [location, startDate, endDate])

  useEffect(() => {
    if (startDate && endDate) fetchVisits()
  }, [fetchVisits])

  // Build leaderboard counts
  const leaderboard = React.useMemo(() => {
    const counts = {}
    data.forEach(v => {
      if (wantedStatuses.includes(v.status) && v.doctor) {
        counts[v.doctor] = (counts[v.doctor]||0) + 1
      }
    })
    return Object.entries(counts)
      .map(([doctor, count])=>({ doctor, count }))
      .sort((a,b)=> b.count - a.count)
  }, [data, wantedStatuses])

  if (!startDate || !endDate) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Missing date parameters.</Text>
        <Button title="Go Back" onPress={()=>navigation.goBack()} />
      </View>
    )
  }
  if (loading) {
    return <ActivityIndicator style={styles.center} size="large" />
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Error: {error}</Text>
        <Button title="Retry" onPress={fetchVisits} />
      </View>
    )
  }
  if (leaderboard.length === 0) {
    return (
      <View style={styles.center}>
        <Text>No matching visits to build leaderboard.</Text>
        <Button title="Go Back" onPress={()=>navigation.goBack()} />
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.leaderboardContainer}>
      <Text style={styles.leaderboardTitle}>Leaderboard</Text>
      {leaderboard.map((item, idx) => (
        <Text key={item.doctor} style={styles.leaderboardItem}>
          {idx + 1}. Dr {item.doctor}: {item.count} patient{item.count !== 1 ? 's' : ''}
        </Text>
      ))}
    </ScrollView>
  )
}

const Stack = createNativeStackNavigator()

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home" screenOptions={{ headerTitleAlign:'center' }}>
        <Stack.Screen name="Home"    component={HomeScreen}    />
        <Stack.Screen name="Results" component={ResultsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  safe:               { flex:1, backgroundColor:'#fff' },
  container:          { padding:16 },
  label:              { fontSize:16, marginVertical:8 },
  pickerWrapper:      { borderWidth:1, borderColor:'#ccc', borderRadius:4, marginBottom:16 },
  input:              { borderWidth:1, borderColor:'#ccc', borderRadius:4, padding:8, marginBottom:16 },
  buttonWrapper:      { marginVertical:16 },
  center:             { flex:1, justifyContent:'center', alignItems:'center' },
  error:              { color:'red', marginBottom:8 },
  leaderboardContainer:{ padding:16 },
  leaderboardTitle:   { fontSize:20, fontWeight:'700', marginBottom:12 },
  leaderboardItem:    { fontSize:16, marginVertical:4 },
})
